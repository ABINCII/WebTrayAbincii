
import { Component, Property } from '@wonderlandengine/api';

export class ARMenuManager extends Component {
    static TypeName = 'ar-menu-manager';

    static Properties = {
        apiBase: Property.string('https://api.abincii.com/api'),

        // You can enter either the R2 domain or the full /models/ URL.
        // getModelUrl() normalizes both forms automatically.
        r2Base: Property.string(
            'https://pub-5f00c6484f634858a427e577f435334d.r2.dev/models/'
        ),

        displayRoot: Property.object(),
        modelScale: Property.float(0.3),
        rotateSpeed: Property.float(90.0),
    };

    init() {
        this.products = [];
        this.filteredProducts = [];
        this.categories = [];

        this.currentType = 'meal';
        this.currentCategory = 'all';
        this.currentIndex = 0;
        this.currentProduct = null;

        this.modelPool = new Map();
        this.modelPrefabs = new Map();
        this.modelLoads = new Map();

        this.activeModelRoot = null;
        this.modelRequestId = 0;

        this.preloadQueue = [];
        this.preloadQueuedIds = new Set();
        this.preloadWorkerRunning = false;

        this.maxCachedInstances = 8;
        this.isRotating = false;
        this.currentScaleFactor = 1.0;

        this.zoomSettings = {
            0.5: { scale: 0.5, fov: 85 },
            1.0: { scale: 1.0, fov: 60 },
            2.0: { scale: 2.0, fov: 75 },
        };
    }

    async start() {
        this.createUI();
        window.arMenu = this;

        const params = new URLSearchParams(window.location.search);
        this.restaurantId = params.get('restaurant');
        this.tableId = params.get('table');

        if (!this.restaurantId) {
            console.error(
                'ARMenuManager: No restaurant ID found in URL.'
            );
            this.setStatus('No restaurant ID was provided.');
            return;
        }

        console.log('Restaurant:', this.restaurantId);
        console.log('Table:', this.tableId);
        console.log('Configured R2 base:', this.r2Base);

        this.setZoom(1.0);

        await this.fetchMenu(this.restaurantId);

        this.buildCategories();
        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
            this.startRestaurantPreload();
        } else {
            this.setStatus(
                this.currentType === 'meal'
                    ? 'No meals found. Select Drinks to view drinks.'
                    : 'No drinks found. Select Meals to view meals.'
            );
        }
    }

    /* =========================================
     * FETCH RESTAURANT MENU
     * ========================================= */

    async fetchMenu(restaurantId) {
        try {
            this.setStatus('Loading menu...');

            const base = String(this.apiBase || '').replace(/\/+$/, '');
            const url =
                `${base}/restaurants/menu` +
                `?restaurant=${encodeURIComponent(restaurantId)}`;

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Menu API returned HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error('Backend returned success=false');
            }

            const meals = (data.meal || []).map(meal => ({
                type: 'meal',
                id: String(meal._id || ''),
                name: meal.mealName || 'Unnamed Meal',
                desc: meal.desc || '',
                price: meal.price,
                category: meal.category || 'Uncategorized',
                img: meal.mealImg || '',
                raw: meal,
            }));

            const drinks = (data.drink || []).map(drink => ({
                type: 'drink',
                id: String(drink._id || ''),
                name: drink.drinkName || 'Unnamed Drink',
                desc: drink.desc || '',
                price: drink.price,
                category: drink.category || 'Uncategorized',
                img: drink.drinkImg || '',
                raw: drink,
            }));

            // The endpoint has already scoped this catalogue to the restaurant.
            this.products = [...meals, ...drinks].filter(p => p.id);

            console.log(
                `Loaded ${this.products.length} products for restaurant ${restaurantId}`,
                {
                    meals: meals.length,
                    drinks: drinks.length,
                }
            );

            this.setStatus('');
        } catch (error) {
            console.error('ARMenuManager: Failed to fetch menu:', error);
            this.products = [];
            this.setStatus('Unable to load menu. Check the API connection.');
        }
    }

    /* =========================================
     * CATEGORY FILTERING
     * ========================================= */

    buildCategories() {
        const categorySet = new Set();

        for (const product of this.products) {
            if (
                product.type === this.currentType &&
                product.category
            ) {
                categorySet.add(product.category);
            }
        }

        this.categories = [
            'all',
            ...Array.from(categorySet).sort((a, b) =>
                String(a).localeCompare(String(b))
            ),
        ];

        if (
            this.currentCategory !== 'all' &&
            !categorySet.has(this.currentCategory)
        ) {
            this.currentCategory = 'all';
        }

        this.updateFilterUI();
    }

    applyFilters() {
        this.filteredProducts = this.products.filter(product => {
            const typeMatches = product.type === this.currentType;
            const categoryMatches =
                this.currentCategory === 'all' ||
                product.category === this.currentCategory;

            return typeMatches && categoryMatches;
        });

        this.currentIndex = 0;
        this.updateFilterUI();
        this.updateUI();
    }

    setType(type) {
        if (type !== 'meal' && type !== 'drink') {
            console.warn(
                'ARMenuManager: Type must be "meal" or "drink".'
            );
            return;
        }

        this.currentType = type;
        this.currentCategory = 'all';

        this.buildCategories();
        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
        } else {
            this.hideActiveModel();
            this.hideImageFallback();
            this.currentProduct = null;
            this.updateUI();

            this.setStatus(
                type === 'meal'
                    ? 'No meals found. Select Drinks to view drinks.'
                    : 'No drinks found. Select Meals to view meals.'
            );
        }
    }

    setCategory(category) {
        this.currentCategory = category;
        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
        } else {
            this.hideActiveModel();
            this.hideImageFallback();
            this.currentProduct = null;
            this.updateUI();
            this.setStatus('No products found in this category.');
        }
    }

    /* =========================================
     * PRODUCT NAVIGATION
     * ========================================= */

    next() {
        if (!this.filteredProducts.length) return;

        this.currentIndex =
            (this.currentIndex + 1) % this.filteredProducts.length;

        this.showProduct(this.currentIndex);
    }

    prev() {
        if (!this.filteredProducts.length) return;

        this.currentIndex =
            (this.currentIndex - 1 + this.filteredProducts.length) %
            this.filteredProducts.length;

        this.showProduct(this.currentIndex);
    }

    /* =========================================
     * PRODUCT ID AND CORRECTED R2 URL
     * ========================================= */

    getModelId(product) {
        return product && product.id ? String(product.id) : '';
    }

    getModelUrl(product) {
        const modelId = this.getModelId(product);

        if (!modelId) {
            throw new Error('Missing MongoDB product ID.');
        }

        /*
         * FIX:
         * Handles all of these Inspector values:
         *
         * https://example.r2.dev
         * https://example.r2.dev/
         * https://example.r2.dev/models
         * https://example.r2.dev/models/
         *
         * All produce:
         * https://example.r2.dev/models/PRODUCT_ID.glb
         */
        let base = String(this.r2Base || '').trim();

        if (!base) {
            throw new Error('R2 base URL is empty.');
        }

        base = base.replace(/\/+$/, '');

        if (!/\/models$/i.test(base)) {
            base += '/models';
        }

        const url = `${base}/${encodeURIComponent(modelId)}.glb`;

        console.log('Constructed GLB URL:', url);

        return url;
    }

    /* =========================================
     * LOAD AND CACHE GLB PREFABS
     * ========================================= */

    ensurePrefab(product) {
        const modelId = this.getModelId(product);

        if (!modelId) {
            return Promise.reject(
                new Error('Missing MongoDB product ID.')
            );
        }

        if (this.modelPrefabs.has(modelId)) {
            return Promise.resolve(this.modelPrefabs.get(modelId));
        }

        // Reuse an in-progress load for the same product.
        if (this.modelLoads.has(modelId)) {
            return this.modelLoads.get(modelId);
        }

        let url;

        try {
            url = this.getModelUrl(product);
        } catch (error) {
            return Promise.reject(error);
        }

        console.log(
            `Loading GLB for product ID: ${modelId}`,
            url
        );

        const loadPromise = this.engine.loadGLTF({ file: url })
            .then(prefab => {
                this.modelPrefabs.set(modelId, prefab);
                this.dispatchModelReady(product, true);
                return prefab;
            })
            .catch(error => {
                console.error(
                    `ARMenuManager: GLB load failed for "${modelId}".`,
                    {
                        url,
                        error,
                    }
                );

                throw error;
            })
            .finally(() => {
                this.modelLoads.delete(modelId);
            });

        this.modelLoads.set(modelId, loadPromise);

        return loadPromise;
    }

    /* =========================================
     * SHOW SELECTED PRODUCT
     * ========================================= */

    async showProduct(index) {
        if (!this.filteredProducts.length) return;

        index = Math.max(
            0,
            Math.min(index, this.filteredProducts.length - 1)
        );

        this.currentIndex = index;
        this.currentProduct = this.filteredProducts[index];

        this.updateUI();
        this.hideActiveModel();
        this.hideImageFallback();

        const requestId = ++this.modelRequestId;
        const product = this.currentProduct;
        const modelId = this.getModelId(product);

        if (product.img) {
            this.showImageFallback(product.img);
        }

        if (!modelId) {
            this.setStatus('No model ID is available for this product.');
            this.dispatchModelReady(product, false);
            return;
        }

        // Reuse an already-instantiated scene object when possible.
        const cached = this.modelPool.get(modelId);

        if (cached) {
            if (requestId !== this.modelRequestId) return;

            cached.lastUsed = Date.now();
            cached.root.active = true;
            this.activeModelRoot = cached.root;

            this.placeModel(cached.root);
            this.applyScaleToCurrent();
            this.hideImageFallback();
            this.setStatus('');
            return;
        }

        this.setStatus('Loading 3D model...');

        try {
            const prefab = await this.ensurePrefab(product);

            // The user may have selected another product during loading.
            if (requestId !== this.modelRequestId) return;

            const result = this.engine.scene.instantiate(prefab);
            const root = result.root;

            if (!root) {
                throw new Error('GLB prefab did not create a root object.');
            }

            root.parent = this.displayRoot;
            root.setTranslationLocal([0, 0.1, 0]);

            const scale = this.modelScale * this.currentScaleFactor;

            root.setScalingLocal([scale, scale, scale]);
            root.active = true;

            this.modelPool.set(modelId, {
                root,
                prefab,
                lastUsed: Date.now(),
            });

            this.activeModelRoot = root;
            this.hideImageFallback();
            this.setStatus('');

            this.evictOldModelInstances(modelId);
            this.dispatchModelReady(product, true);
        } catch (error) {
            console.error(
                `ARMenuManager: Could not display GLB "${modelId}".`,
                error
            );

            if (requestId === this.modelRequestId) {
                this.showImageFallback(product.img);

                this.setStatus(
                    product.img
                        ? '3D model unavailable. Showing product image.'
                        : '3D model unavailable. Check the GLB URL and R2 access.'
                );

                this.dispatchModelReady(product, false);
            }
        }
    }

    /* =========================================
     * RESTAURANT-SPECIFIC BACKGROUND PRELOAD
     * ========================================= */

    startRestaurantPreload() {
        // Only preload products returned by this restaurant's menu API.
        for (const product of this.products) {
            const id = this.getModelId(product);

            if (
                !id ||
                this.modelPrefabs.has(id) ||
                this.modelLoads.has(id) ||
                this.preloadQueuedIds.has(id)
            ) {
                continue;
            }

            this.preloadQueue.push(product);
            this.preloadQueuedIds.add(id);
        }

        console.log(
            `ARMenuManager: Queued ${this.preloadQueue.length} models for background preload.`
        );

        this.pumpPreloadQueue();
    }

    pumpPreloadQueue() {
        if (this.preloadWorkerRunning) return;

        this.preloadWorkerRunning = true;

        const runNext = async () => {
            try {
                while (this.preloadQueue.length > 0) {
                    const product = this.preloadQueue.shift();
                    const id = this.getModelId(product);

                    this.preloadQueuedIds.delete(id);

                    if (!id || this.modelPrefabs.has(id)) {
                        continue;
                    }

                    try {
                        // Load one model at a time to reduce mobile contention.
                        await this.ensurePrefab(product);
                        console.log(
                            `ARMenuManager: Preloaded model "${id}".`
                        );
                    } catch (error) {
                        // Include the URL and actual error for easier debugging.
                        let url = 'URL unavailable';

                        try {
                            url = this.getModelUrl(product);
                        } catch (_) {
                            // The original error will be logged below.
                        }

                        console.error(
                            `ARMenuManager: Background preload failed for "${id}".`,
                            { url, error }
                        );
                    }
                }
            } finally {
                this.preloadWorkerRunning = false;
            }
        };

        runNext();
    }

    dispatchModelReady(product, available) {
        window.dispatchEvent(
            new CustomEvent('armenu-model-ready', {
                detail: {
                    productId: this.getModelId(product),
                    product,
                    available,
                },
            })
        );
    }

    /* =========================================
     * INSTANCE CACHE MANAGEMENT
     * ========================================= */

    evictOldModelInstances(keepModelId) {
        if (this.modelPool.size <= this.maxCachedInstances) return;

        const candidates = Array.from(this.modelPool.entries())
            .filter(([id, entry]) =>
                id !== keepModelId &&
                entry.root !== this.activeModelRoot
            )
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

        while (
            this.modelPool.size > this.maxCachedInstances &&
            candidates.length > 0
        ) {
            const [id, entry] = candidates.shift();

            try {
                entry.root.active = false;

                if (typeof entry.root.destroy === 'function') {
                    entry.root.destroy();
                }

                this.modelPool.delete(id);
            } catch (error) {
                console.warn(
                    `ARMenuManager: Could not evict model "${id}".`,
                    error
                );
                break;
            }
        }
    }

    hideActiveModel() {
        if (!this.activeModelRoot) return;

        this.activeModelRoot.active = false;

        for (const entry of this.modelPool.values()) {
            if (entry.root === this.activeModelRoot) {
                entry.lastUsed = Date.now();
                break;
            }
        }

        this.activeModelRoot = null;
    }

    placeModel(root) {
        if (!root) return;
        root.setTranslationLocal([0, 0.1, 0]);
    }

    /* =========================================
     * ROTATION
     * ========================================= */

    update(dt) {
        if (!this.isRotating || !this.activeModelRoot) return;

        const angle = this.rotateSpeed * dt * (Math.PI / 180);

        this.activeModelRoot.rotateAxisAngleRadObject(
            [0, 1, 0],
            angle
        );
    }

    startRotation() {
        this.isRotating = true;
    }

    stopRotation() {
        this.isRotating = false;
    }

    /* =========================================
     * ZOOM
     * ========================================= */

    setZoom(factor) {
        const setting = this.zoomSettings[factor];
        if (!setting) return;

        this.currentScaleFactor = setting.scale;
        this.applyScaleToCurrent();

        const view = this.engine.scene.mainView;

        if (view) {
            view.fov = setting.fov;
        }

        document.querySelectorAll('.zoom-btn').forEach(button => {
            button.classList.remove('active');
        });

        const activeId =
            factor === 0.5
                ? 'zoom-x05'
                : factor === 2.0
                    ? 'zoom-x2'
                    : 'zoom-x1';

        document.getElementById(activeId)?.classList.add('active');
    }

    applyScaleToCurrent() {
        if (!this.activeModelRoot) return;

        const scale = this.modelScale * this.currentScaleFactor;

        this.activeModelRoot.setScalingLocal([
            scale,
            scale,
            scale,
        ]);
    }

    /* =========================================
     * 2D IMAGE FALLBACK
     * ========================================= */

    showImageFallback(imgUrl) {
        const container = document.getElementById(
            'product-image-container'
        );
        const img = document.getElementById('product-image');

        if (!container || !img) return;

        if (!imgUrl) {
            container.style.display = 'none';
            return;
        }

        img.onerror = () => {
            container.style.display = 'none';
            console.warn('ARMenuManager: Product image failed to load:', imgUrl);
        };

        img.src = imgUrl;
        container.style.display = 'block';
    }

    hideImageFallback() {
        const container = document.getElementById(
            'product-image-container'
        );

        if (container) {
            container.style.display = 'none';
        }
    }

    /* =========================================
     * PRICE FORMATTING
     * ========================================= */

    formatPrice(price) {
        if (price === null || price === undefined || price === '') {
            return '—';
        }

        const number = Number(price);

        if (Number.isNaN(number)) {
            return String(price);
        }

        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            maximumFractionDigits: 0,
        }).format(number);
    }

    /* =========================================
     * UI CREATION
     * ========================================= */

    createUI() {
        document.getElementById('model-ui-root')?.remove();
        document.getElementById('product-image-container')?.remove();

        const imageContainer = document.createElement('div');
        imageContainer.id = 'product-image-container';
        imageContainer.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9998;
            display: none;
            width: 90%;
            max-width: 600px;
            max-height: 55vh;
            border-radius: 20px;
            overflow: hidden;
            background: rgba(0,0,0,0.85);
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            pointer-events: none;
        `;

        const image = document.createElement('img');
        image.id = 'product-image';
        image.alt = 'Product image';
        image.style.cssText = `
            width: 100%;
            height: auto;
            max-height: 55vh;
            object-fit: contain;
            display: block;
        `;

        imageContainer.appendChild(image);
        document.body.appendChild(imageContainer);

        const root = document.createElement('div');
        root.id = 'model-ui-root';
        root.style.cssText = `
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 9999;
            pointer-events: none;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 0 12px max(16px, env(safe-area-inset-bottom));
            font-family: system-ui, -apple-system, BlinkMacSystemFont,
                "Segoe UI", Roboto, sans-serif;
            box-sizing: border-box;
        `;

        /* Product type and category filters */

        const filterPanel = document.createElement('div');
        filterPanel.id = 'menu-filter-panel';
        filterPanel.style.cssText = `
            pointer-events: auto;
            width: 100%;
            max-width: 520px;
            margin-bottom: 8px;
            display: flex;
            gap: 8px;
            overflow-x: auto;
            scrollbar-width: none;
            padding: 2px;
            box-sizing: border-box;
        `;

        const typeButtons = document.createElement('div');
        typeButtons.style.cssText = `
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        `;

        const createFilterButton = (label, value) => {
            const button = document.createElement('button');
            button.textContent = label;
            button.dataset.type = value;
            button.style.cssText = `
                border: none;
                padding: 9px 13px;
                border-radius: 999px;
                background: rgba(0,0,0,0.72);
                color: white;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
                touch-action: manipulation;
            `;
            button.onclick = () => this.setType(value);
            return button;
        };

        // Meals is the default. There is no "All products" type.
        typeButtons.appendChild(createFilterButton('Meals', 'meal'));
        typeButtons.appendChild(createFilterButton('Drinks', 'drink'));
        filterPanel.appendChild(typeButtons);

        const categorySelect = document.createElement('select');
        categorySelect.id = 'category-select';
        categorySelect.style.cssText = `
            border: none;
            padding: 9px 12px;
            border-radius: 999px;
            background: rgba(0,0,0,0.72);
            color: white;
            font-size: 13px;
            font-weight: 600;
            outline: none;
            max-width: 180px;
        `;

        categorySelect.onchange = () => {
            this.setCategory(categorySelect.value);
        };

        filterPanel.appendChild(categorySelect);
        root.appendChild(filterPanel);

        /* Product information panel */

        const panel = document.createElement('div');
        panel.id = 'product-panel';
        panel.style.cssText = `
            pointer-events: none;
            width: 100%;
            max-width: 420px;
            background: rgba(0,0,0,0.72);
            border-radius: 16px;
            padding: 14px 18px;
            margin-bottom: 10px;
            color: white;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
            box-sizing: border-box;
        `;

        const title = document.createElement('div');
        title.id = 'product-title';
        title.style.cssText = `
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 5px;
            line-height: 1.25;
        `;

        const description = document.createElement('div');
        description.id = 'product-description';
        description.style.cssText = `
            font-size: 13px;
            opacity: 0.9;
            line-height: 1.4;
            margin-bottom: 8px;
        `;

        const price = document.createElement('div');
        price.id = 'product-price';
        price.style.cssText = `
            font-size: 21px;
            font-weight: 700;
            color: #4ade80;
        `;

        const counter = document.createElement('div');
        counter.id = 'product-counter';
        counter.style.cssText = `
            font-size: 11px;
            opacity: 0.65;
            margin-top: 5px;
        `;

        panel.append(title, description, price, counter);
        root.appendChild(panel);

        const status = document.createElement('div');
        status.id = 'menu-status';
        status.style.cssText = `
            color: white;
            font-size: 12px;
            margin-bottom: 6px;
            text-shadow: 0 2px 5px black;
            min-height: 16px;
            text-align: center;
        `;
        root.appendChild(status);

        /* Navigation and rotation controls */

        const buttons = document.createElement('div');
        buttons.style.cssText = `
            display: flex;
            gap: 8px;
            pointer-events: auto;
            flex-wrap: wrap;
            justify-content: center;
            max-width: 520px;
        `;

        const buttonStyle = `
            pointer-events: auto;
            padding: 11px 14px;
            font-size: 13px;
            font-weight: 600;
            border-radius: 12px;
            border: none;
            background: rgba(0,0,0,0.75);
            color: white;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            touch-action: manipulation;
            min-height: 42px;
        `;

        const prev = document.createElement('button');
        prev.textContent = '◀ Prev';
        prev.style.cssText = buttonStyle;
        prev.onclick = () => this.prev();

        const rotate = document.createElement('button');
        rotate.textContent = '🔄 Hold to Rotate';
        rotate.style.cssText = buttonStyle;

        rotate.addEventListener('pointerdown', event => {
            event.preventDefault();
            this.startRotation();
            try {
                rotate.setPointerCapture(event.pointerId);
            } catch (_) {}
        });

        const stopRotate = () => this.stopRotation();

        rotate.addEventListener('pointerup', stopRotate);
        rotate.addEventListener('pointercancel', stopRotate);
        rotate.addEventListener('lostpointercapture', stopRotate);
        rotate.addEventListener('contextmenu', event => event.preventDefault());

        const next = document.createElement('button');
        next.textContent = 'Next ▶';
        next.style.cssText = buttonStyle;
        next.onclick = () => this.next();

        buttons.append(prev, rotate, next);
        root.appendChild(buttons);

        /* Zoom controls */

        const zoomRow = document.createElement('div');
        zoomRow.style.cssText = `
            display: flex;
            gap: 7px;
            pointer-events: auto;
            margin-top: 8px;
            justify-content: center;
        `;

        const createZoomButton = (id, label, factor) => {
            const button = document.createElement('button');
            button.id = id;
            button.className = 'zoom-btn';
            button.textContent = label;
            button.style.cssText = buttonStyle;
            button.onclick = () => this.setZoom(factor);
            return button;
        };

        zoomRow.append(
            createZoomButton('zoom-x05', '×0.5', 0.5),
            createZoomButton('zoom-x1', '×1', 1.0),
            createZoomButton('zoom-x2', '×2', 2.0)
        );

        root.appendChild(zoomRow);
        document.body.appendChild(root);

        this.updateFilterUI();
    }

    /* =========================================
     * UPDATE FILTER UI
     * ========================================= */

    updateFilterUI() {
        const select = document.getElementById('category-select');

        if (select) {
            select.innerHTML = '';

            for (const category of this.categories) {
                const option = document.createElement('option');
                option.value = category;

                option.textContent = category === 'all'
                    ? (
                        this.currentType === 'meal'
                            ? 'All Meal Categories'
                            : 'All Drink Categories'
                    )
                    : category;

                option.selected = category === this.currentCategory;
                select.appendChild(option);
            }
        }

        document.querySelectorAll('[data-type]').forEach(button => {
            const active = button.dataset.type === this.currentType;

            button.style.background = active
                ? 'rgba(74,222,128,0.85)'
                : 'rgba(0,0,0,0.72)';

            button.style.color = active ? '#06140b' : 'white';
        });
    }

    /* =========================================
     * UPDATE PRODUCT DETAILS
     * ========================================= */

    updateUI() {
        const title = document.getElementById('product-title');
        const description = document.getElementById('product-description');
        const price = document.getElementById('product-price');
        const counter = document.getElementById('product-counter');

        if (!title || !description || !price || !counter) return;

        if (!this.currentProduct) {
            title.textContent = '';
            description.textContent = '';
            price.textContent = '';
            counter.textContent = '';
            return;
        }

        title.textContent = this.currentProduct.name;
        description.textContent = this.currentProduct.desc;
        price.textContent = this.formatPrice(this.currentProduct.price);

        counter.textContent =
            `${this.currentIndex + 1} / ${this.filteredProducts.length}`;

        window.dispatchEvent(
            new CustomEvent('armenu-update', {
                detail: {
                    product: this.currentProduct,
                    index: this.currentIndex,
                    total: this.filteredProducts.length,
                    categories: this.categories,
                    type: this.currentType,
                    category: this.currentCategory,
                },
            })
        );
    }

    /* =========================================
     * STATUS MESSAGE
     * ========================================= */

    setStatus(message) {
        const status = document.getElementById('menu-status');

        if (status) {
            status.textContent = message || '';
        }
    }
}
