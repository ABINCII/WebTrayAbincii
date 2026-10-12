
import {Component, Property} from '@wonderlandengine/api';

export class ARMenuManager extends Component {
    static TypeName = 'ar-menu-manager';

    static Properties = {
        apiBase: Property.string('https://api.abincii.com/api'),
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

        this.availableModelIds = new Set();
        this.modelManifestLoaded = false;

        this.preloadQueue = [];
        this.preloadQueuedIds = new Set();
        this.preloadWorkerRunning = false;
        this.maxCachedInstances = 8;

        this.activeModelRoot = null;
        this.modelRequestId = 0;
        this.isRotating = false;
        this.currentScaleFactor = 1.0;

        this.zoomSettings = {
            '0.5': {scale: 0.5, fov: 85},
            '1': {scale: 1.0, fov: 60},
            '2': {scale: 2.0, fov: 75}
        };
    }

    async start() {
        this.createUI();
        window.arMenu = this;

        const params = new URLSearchParams(window.location.search);
        this.restaurantId = params.get('restaurant');
        this.tableId = params.get('table');

        if (!this.restaurantId) {
            this.setStatus('No restaurant ID was provided.');
            console.error('ARMenuManager: Missing restaurant query parameter.');
            return;
        }

        console.log('Restaurant:', this.restaurantId);
        console.log('Table:', this.tableId);

        this.setZoom(1);

        // Keep the existing backend unchanged.
        await this.fetchMenu(this.restaurantId);

        // Load the list of GLBs that actually exist in R2.
        await this.loadModelManifest();

        this.buildCategories();
        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
            this.startRestaurantPreload();
        } else {
            this.setStatus(
                this.currentType === 'meal'
                    ? 'No meals found. Select Drinks to view drinks.'
                    : 'No drinks found. Select Meals to view drinks.'
            );
        }
    }

    /* =========================================
       API MENU
    ========================================= */

    async fetchMenu(restaurantId) {
        try {
            this.setStatus('Loading menu...');

            const url =
                `${this.apiBase.replace(/\/+$/, '')}/restaurants/menu` +
                `?restaurant=${encodeURIComponent(restaurantId)}`;

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Menu API returned HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error('Menu API returned success=false');
            }

            const meals = (data.meal || []).map(item => ({
                type: 'meal',
                id: String(item._id || ''),
                name: item.mealName || 'Unnamed Meal',
                desc: item.desc || '',
                price: item.price,
                category: item.category || 'Uncategorized',
                img: item.mealImg || '',
                raw: item
            }));

            const drinks = (data.drink || []).map(item => ({
                type: 'drink',
                id: String(item._id || ''),
                name: item.drinkName || 'Unnamed Drink',
                desc: item.desc || '',
                price: item.price,
                category: item.category || 'Uncategorized',
                img: item.drinkImg || '',
                raw: item
            }));

            this.products = [...meals, ...drinks];

            console.log(
                `Loaded ${this.products.length} menu products.`
            );
        } catch (error) {
            console.error('ARMenuManager: Menu fetch failed:', error);
            this.products = [];
            this.setStatus('Unable to load menu.');
        }
    }

    /* =========================================
       MODEL MANIFEST
    ========================================= */

    getR2ModelsBase() {
        let base = String(this.r2Base || '').trim().replace(/\/+$/, '');

        if (!base) {
            throw new Error('R2 model URL is not configured.');
        }

        if (!/\/models$/i.test(base)) {
            base += '/models';
        }

        return base;
    }

    async loadModelManifest() {
        this.availableModelIds.clear();
        this.modelManifestLoaded = false;

        const manifestUrl = `${this.getR2ModelsBase()}/models.json`;

        try {
            console.log('Loading 3D model manifest:', manifestUrl);

            const response = await fetch(manifestUrl, {
                cache: 'no-cache'
            });

            if (!response.ok) {
                throw new Error(
                    `Manifest returned HTTP ${response.status}`
                );
            }

            const manifest = await response.json();

            if (!Array.isArray(manifest.models)) {
                throw new Error(
                    'models.json must contain a "models" array.'
                );
            }

            for (const value of manifest.models) {
                if (typeof value !== 'string') continue;

                const id = value.trim();

                // Only MongoDB-style product IDs are accepted.
                if (/^[a-f\d]{24}$/i.test(id)) {
                    this.availableModelIds.add(id);
                } else {
                    console.warn(
                        'Ignoring invalid model ID in manifest:',
                        value
                    );
                }
            }

            this.modelManifestLoaded = true;

            console.log(
                `Model manifest loaded: ${this.availableModelIds.size} model(s).`
            );
        } catch (error) {
            // Fail closed: do not try to download a GLB for every product.
            this.availableModelIds.clear();
            this.modelManifestLoaded = false;

            console.error(
                'ARMenuManager: Could not load models.json. ' +
                '3D loading is disabled until the manifest is available.',
                error
            );

            this.setStatus(
                '3D previews unavailable. Showing product images where available.'
            );
        }
    }

    getProductId(product) {
        return product && product.id ? String(product.id) : '';
    }

    getModelId(product) {
        if (!this.modelManifestLoaded) return '';

        const id = this.getProductId(product);

        return this.availableModelIds.has(id) ? id : '';
    }

    getModelUrl(product) {
        const modelId = this.getModelId(product);

        if (!modelId) return '';

        return (
            `${this.getR2ModelsBase()}/` +
            `${encodeURIComponent(modelId)}.glb`
        );
    }

    /* =========================================
       CATEGORY FILTERING
    ========================================= */

    buildCategories() {
        const values = new Set();

        for (const product of this.products) {
            if (
                product.type === this.currentType &&
                product.category
            ) {
                values.add(product.category);
            }
        }

        this.categories = [
            'all',
            ...Array.from(values).sort((a, b) =>
                String(a).localeCompare(String(b))
            )
        ];

        if (
            this.currentCategory !== 'all' &&
            !values.has(this.currentCategory)
        ) {
            this.currentCategory = 'all';
        }
    }

    applyFilters() {
        this.filteredProducts = this.products.filter(product => {
            const matchesType = product.type === this.currentType;
            const matchesCategory =
                this.currentCategory === 'all' ||
                product.category === this.currentCategory;

            return matchesType && matchesCategory;
        });

        this.currentIndex = 0;
        this.updateFilterUI();
        this.updateUI();
    }

    setType(type) {
        if (type !== 'meal' && type !== 'drink') return;

        this.currentType = type;
        this.currentCategory = 'all';

        this.buildCategories();
        this.applyFilters();

        if (this.filteredProducts.length) {
            this.showProduct(0);
        } else {
            this.modelRequestId++;
            this.hideActiveModel();
            this.hideImageFallback();
            this.currentProduct = null;
            this.updateUI();

            this.setStatus(
                type === 'meal' ? 'No meals found.' : 'No drinks found.'
            );
        }
    }

    setCategory(category) {
        this.currentCategory = category;
        this.applyFilters();

        if (this.filteredProducts.length) {
            this.showProduct(0);
        } else {
            this.modelRequestId++;
            this.hideActiveModel();
            this.hideImageFallback();
            this.currentProduct = null;
            this.updateUI();
            this.setStatus('No products found in this category.');
        }
    }

    /* =========================================
       PRODUCT NAVIGATION
    ========================================= */

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
       DISPLAY PRODUCT
    ========================================= */

    async showProduct(index) {
        if (!this.filteredProducts.length) return;

        index = Math.max(
            0,
            Math.min(index, this.filteredProducts.length - 1)
        );

        this.currentIndex = index;
        this.currentProduct = this.filteredProducts[index];

        const product = this.currentProduct;
        const requestId = ++this.modelRequestId;

        this.hideActiveModel();
        this.hideImageFallback();
        this.updateUI();

        // Always show the 2D image first if one exists.
        if (product.img) {
            this.showImageFallback(product.img);
        }

        const modelId = this.getModelId(product);

        // Critical: products not listed in models.json never trigger
        // a request for a nonexistent GLB.
        if (!modelId) {
            this.setStatus(
                product.img
                    ? '3D preview unavailable for this item.'
                    : 'No 3D model or product image available.'
            );

            this.dispatchModelReady(product, false);
            return;
        }

        const cached = this.modelPool.get(modelId);

        if (cached) {
            if (requestId !== this.modelRequestId) return;

            cached.root.active = true;
            cached.lastUsed = Date.now();
            this.activeModelRoot = cached.root;

            this.placeModel(cached.root);
            this.applyScaleToCurrent();
            this.hideImageFallback();
            this.setStatus('');
            this.dispatchModelReady(product, true);
            return;
        }

        this.setStatus('Loading 3D model...');

        try {
            const prefab = await this.ensurePrefab(product);

            // Do not display an old product after the user navigates.
            if (requestId !== this.modelRequestId) return;

            const result = this.engine.scene.instantiate(prefab);
            const root = result.root;

            root.parent = this.displayRoot;
            root.setTranslationLocal([0, 0.1, 0]);
            root.setScalingLocal([
                this.modelScale,
                this.modelScale,
                this.modelScale
            ]);
            root.active = true;

            this.modelPool.set(modelId, {
                root,
                prefab,
                lastUsed: Date.now()
            });

            this.activeModelRoot = root;

            this.applyScaleToCurrent();
            this.hideImageFallback();
            this.setStatus('');
            this.evictOldModelInstances(modelId);
            this.dispatchModelReady(product, true);
        } catch (error) {
            console.warn(
                `Could not load GLB for ${modelId}:`,
                error
            );

            if (requestId === this.modelRequestId) {
                this.showImageFallback(product.img);

                this.setStatus(
                    product.img
                        ? 'Showing product image.'
                        : '3D model unavailable.'
                );

                this.dispatchModelReady(product, false);
            }
        }
    }

    /* =========================================
       LOAD AND CACHE GLB PREFABS
    ========================================= */

    ensurePrefab(product) {
        const modelId = this.getModelId(product);

        if (!modelId) {
            return Promise.reject(
                new Error('Product has no registered 3D model.')
            );
        }

        if (this.modelPrefabs.has(modelId)) {
            return Promise.resolve(this.modelPrefabs.get(modelId));
        }

        if (this.modelLoads.has(modelId)) {
            return this.modelLoads.get(modelId);
        }

        const url = this.getModelUrl(product);

        const loadPromise = this.engine.loadGLTF({file: url})
            .then(prefab => {
                this.modelPrefabs.set(modelId, prefab);
                return prefab;
            })
            .finally(() => {
                this.modelLoads.delete(modelId);
            });

        this.modelLoads.set(modelId, loadPromise);
        return loadPromise;
    }

    /* =========================================
       BACKGROUND PRELOAD
    ========================================= */

    startRestaurantPreload() {
        if (!this.modelManifestLoaded) {
            console.warn(
                'Preload skipped because models.json did not load.'
            );
            return;
        }

        for (const product of this.products) {
            const modelId = this.getModelId(product);

            // Products absent from models.json are skipped here.
            if (
                !modelId ||
                this.modelPrefabs.has(modelId) ||
                this.modelLoads.has(modelId) ||
                this.preloadQueuedIds.has(modelId)
            ) {
                continue;
            }

            this.preloadQueue.push(product);
            this.preloadQueuedIds.add(modelId);
        }

        console.log(
            `Preloading ${this.preloadQueue.length} available GLB model(s).`
        );

        this.pumpPreloadQueue();
    }

    pumpPreloadQueue() {
        if (this.preloadWorkerRunning) return;

        this.preloadWorkerRunning = true;

        const run = async () => {
            try {
                while (this.preloadQueue.length) {
                    const product = this.preloadQueue.shift();
                    const modelId = this.getModelId(product);

                    this.preloadQueuedIds.delete(modelId);

                    if (
                        !modelId ||
                        this.modelPrefabs.has(modelId)
                    ) {
                        continue;
                    }

                    try {
                        await this.ensurePrefab(product);
                        console.log('Preloaded GLB:', modelId);
                    } catch (error) {
                        console.warn(
                            `Preload failed for ${modelId}:`,
                            error
                        );
                    }
                }
            } finally {
                this.preloadWorkerRunning = false;
            }
        };

        run();
    }

    dispatchModelReady(product, available) {
        window.dispatchEvent(
            new CustomEvent('armenu-model-ready', {
                detail: {
                    productId: this.getProductId(product),
                    product,
                    available
                }
            })
        );
    }

    /* =========================================
       MODEL CACHE MANAGEMENT
    ========================================= */

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
            candidates.length
        ) {
            const [id, entry] = candidates.shift();

            try {
                entry.root.active = false;

                if (typeof entry.root.destroy === 'function') {
                    entry.root.destroy();
                }

                this.modelPool.delete(id);
            } catch (error) {
                console.warn('Model cache eviction failed:', error);
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
        if (root) {
            root.setTranslationLocal([0, 0.1, 0]);
        }
    }

    /* =========================================
       ROTATION
    ========================================= */

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
       ZOOM
    ========================================= */

    setZoom(factor) {
        const setting = this.zoomSettings[String(factor)];
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

        const ids = {
            '0.5': 'zoom-x05',
            '1': 'zoom-x1',
            '2': 'zoom-x2'
        };

        document.getElementById(ids[String(factor)])?.classList.add('active');
    }

    applyScaleToCurrent() {
        if (!this.activeModelRoot) return;

        const scale = this.modelScale * this.currentScaleFactor;

        this.activeModelRoot.setScalingLocal([
            scale,
            scale,
            scale
        ]);
    }

    /* =========================================
       2D IMAGE FALLBACK
    ========================================= */

    showImageFallback(url) {
        const container = document.getElementById(
            'product-image-container'
        );
        const image = document.getElementById('product-image');

        if (!container || !image) return;

        if (!url) {
            container.style.display = 'none';
            return;
        }

        image.onerror = () => {
            container.style.display = 'none';
        };

        image.src = url;
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
       UI STATUS AND PRICE
    ========================================= */

    setStatus(message) {
        const element = document.getElementById('menu-status');
        if (element) element.textContent = message || '';
    }

    formatPrice(price) {
        if (price === null || price === undefined || price === '') {
            return '—';
        }

        const number = Number(price);

        if (Number.isNaN(number)) return String(price);

        return new Intl.NumberFormat('en-NG', {
            style: 'currency',
            currency: 'NGN',
            maximumFractionDigits: 0
        }).format(number);
    }

    updateUI() {
        const product = this.currentProduct;

        const title = document.getElementById('product-title');
        const description = document.getElementById('product-description');
        const price = document.getElementById('product-price');
        const counter = document.getElementById('product-counter');

        if (!product) {
            if (title) title.textContent = 'No products found';
            if (description) description.textContent = '';
            if (price) price.textContent = '';
            if (counter) counter.textContent = '0 items';
            return;
        }

        if (title) title.textContent = product.name;
        if (description) description.textContent = product.desc;
        if (price) price.textContent = this.formatPrice(product.price);

        if (counter) {
            counter.textContent =
                `${this.currentIndex + 1} of ${this.filteredProducts.length}`;
        }

        document.querySelectorAll('[data-type]').forEach(button => {
            const selected = button.dataset.type === this.currentType;
            button.style.background = selected
                ? '#16a34a'
                : 'rgba(0,0,0,0.72)';
        });
    }

    updateFilterUI() {
        const select = document.getElementById('category-select');
        if (!select) return;

        select.replaceChildren();

        for (const category of this.categories) {
            const option = document.createElement('option');

            option.value = category;
            option.textContent =
                category === 'all' ? 'All categories' : category;

            select.appendChild(option);
        }

        select.value = this.currentCategory;
    }

    /* =========================================
       CREATE UI
    ========================================= */

    createUI() {
        document.getElementById('model-ui-root')?.remove();
        document.getElementById('product-image-container')?.remove();

        const imageContainer = document.createElement('div');
        imageContainer.id = 'product-image-container';
        imageContainer.style.cssText = `
            position:fixed;top:50%;left:50%;
            transform:translate(-50%,-50%);
            z-index:9998;display:none;width:90%;
            max-width:600px;max-height:55vh;
            border-radius:20px;overflow:hidden;
            background:rgba(0,0,0,.85);
            pointer-events:none;
        `;

        const image = document.createElement('img');
        image.id = 'product-image';
        image.alt = 'Product image';
        image.style.cssText = `
            display:block;width:100%;height:auto;
            max-height:55vh;object-fit:contain;
        `;

        imageContainer.appendChild(image);
        document.body.appendChild(imageContainer);

        const root = document.createElement('div');
        root.id = 'model-ui-root';
        root.style.cssText = `
            position:fixed;left:0;right:0;bottom:0;
            z-index:9999;pointer-events:none;
            display:flex;flex-direction:column;
            align-items:center;padding:12px;
            padding-bottom:max(20px,env(safe-area-inset-bottom));
            font-family:system-ui,sans-serif;
            box-sizing:border-box;
        `;

        const filterPanel = document.createElement('div');
        filterPanel.style.cssText = `
            pointer-events:auto;width:100%;max-width:520px;
            margin-bottom:8px;display:flex;gap:8px;
            overflow-x:auto;align-items:center;
        `;

        const typeButtons = document.createElement('div');
        typeButtons.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

        const makeButton = (label, action, extraClass = '') => {
            const button = document.createElement('button');
            button.textContent = label;
            button.className = extraClass;
            button.style.cssText = `
                border:0;padding:10px 13px;border-radius:12px;
                background:rgba(0,0,0,.78);color:white;
                font-size:13px;font-weight:600;cursor:pointer;
                touch-action:manipulation;
            `;
            button.onclick = action;
            return button;
        };

        typeButtons.appendChild(
            makeButton('Meals', () => this.setType('meal'))
        );
        typeButtons.lastChild.dataset.type = 'meal';

        typeButtons.appendChild(
            makeButton('Drinks', () => this.setType('drink'))
        );
        typeButtons.lastChild.dataset.type = 'drink';

        filterPanel.appendChild(typeButtons);

        const categorySelect = document.createElement('select');
        categorySelect.id = 'category-select';
        categorySelect.style.cssText = `
            padding:10px 12px;border:0;border-radius:12px;
            background:rgba(0,0,0,.78);color:white;
            font-size:13px;max-width:180px;
        `;
        categorySelect.onchange = () =>
            this.setCategory(categorySelect.value);

        filterPanel.appendChild(categorySelect);
        root.appendChild(filterPanel);

        const panel = document.createElement('div');
        panel.id = 'product-panel';
        panel.style.cssText = `
            pointer-events:none;width:100%;max-width:420px;
            background:rgba(0,0,0,.76);color:white;
            border-radius:16px;padding:14px 18px;
            margin-bottom:8px;box-sizing:border-box;
        `;

        const title = document.createElement('div');
        title.id = 'product-title';
        title.style.cssText =
            'font-size:20px;font-weight:700;margin-bottom:5px;';

        const description = document.createElement('div');
        description.id = 'product-description';
        description.style.cssText =
            'font-size:13px;line-height:1.4;margin-bottom:8px;';

        const price = document.createElement('div');
        price.id = 'product-price';
        price.style.cssText =
            'font-size:21px;font-weight:700;color:#4ade80;';

        const counter = document.createElement('div');
        counter.id = 'product-counter';
        counter.style.cssText = 'font-size:11px;opacity:.7;margin-top:5px;';

        panel.append(title, description, price, counter);
        root.appendChild(panel);

        const status = document.createElement('div');
        status.id = 'menu-status';
        status.style.cssText = `
            color:white;font-size:12px;margin-bottom:7px;
            min-height:16px;text-shadow:0 2px 5px black;
        `;
        root.appendChild(status);

        const controls = document.createElement('div');
        controls.style.cssText = `
            pointer-events:auto;display:flex;gap:8px;
            flex-wrap:wrap;justify-content:center;max-width:520px;
        `;

        controls.appendChild(makeButton('◀ Prev', () => this.prev()));
        controls.appendChild(makeButton('Next ▶', () => this.next()));

        const rotate = makeButton('🔄 Hold to Rotate', () => {});
        rotate.addEventListener('pointerdown', event => {
            event.preventDefault();
            this.startRotation();
            rotate.setPointerCapture?.(event.pointerId);
        });
        rotate.addEventListener('pointerup', () => this.stopRotation());
        rotate.addEventListener('pointercancel', () => this.stopRotation());
        rotate.addEventListener('lostpointercapture', () => this.stopRotation());
        controls.appendChild(rotate);

        controls.appendChild(
            makeButton('Zoom −', () => this.setZoom(0.5), 'zoom-btn')
        );
        controls.lastChild.id = 'zoom-x05';

        controls.appendChild(
            makeButton('Zoom 1×', () => this.setZoom(1), 'zoom-btn')
        );
        controls.lastChild.id = 'zoom-x1';

        controls.appendChild(
            makeButton('Zoom +', () => this.setZoom(2), 'zoom-btn')
        );
        controls.lastChild.id = 'zoom-x2';

        root.appendChild(controls);
        document.body.appendChild(root);

        this.updateFilterUI();
        this.updateUI();
    }
}
