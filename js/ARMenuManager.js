
import { Component, Property } from '@wonderlandengine/api';

export class ARMenuManager extends Component {
    static TypeName = 'ar-menu-manager';

    static Properties = {
        apiBase: Property.string('https://api.abincii.com/api'),
        r2Base: Property.string(
            'https://pub-5f00c6484f634858a427e577f435334d.r2.dev/models/'
        ),
        fallbackImageUrl: Property.string('/IMAGEnotfound.jpg'),
        displayRoot: Property.object(),
        modelScale: Property.float(0.3),
        rotateSpeed: Property.float(90.0),
        modelRotationXDegrees: Property.float(90.0),
    };

    init() {
        this.products = [];
        this.filteredProducts = [];
        this.categories = [];

        this.currentType = 'meal';
        this.currentCategory = 'all';
        this.only3DModels = false;
        this.currentIndex = 0;
        this.currentProduct = null;

        this.activeModelRoot = null;
        this.activeModelId = null;

        this.modelPrefabs = new Map();
        this.modelLoads = new Map();
        this.availableModelIds = new Set();

        this.modelManifestLoaded = false;
        this.preloadQueue = [];
        this.preloadQueuedIds = new Set();
        this.preloadWorkerRunning = false;

        this.modelRequestId = 0;
        this.isRotating = false;
        this.currentScaleFactor = 1.0;
        this.swipeStart = null;
        this.swipeListenersInstalled = false;

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
            this.setStatus('No restaurant ID was provided.');
            console.error('ARMenuManager: Missing restaurant ID.');
            return;
        }

        this.setZoom(1.0);

        // Fetch the menu and model manifest independently.
        // Product information does not wait for GLB downloads.
        await Promise.all([
            this.fetchMenu(this.restaurantId),
            this.loadModelManifest(),
        ]);

        this.buildCategories();
        this.applyFilters();

        if (this.filteredProducts.length) {
            this.showProduct(0);
        } else {
            this.setStatus('No meals found. Select Drinks to view drinks.');
        }
    }

    /* MENU API */

    async fetchMenu(restaurantId) {
        try {
            this.setStatus('Loading menu...');

            const base = String(this.apiBase || '').replace(/\/+$/, '');
            const url = base + '/restaurants/menu?restaurant=' +
                encodeURIComponent(restaurantId);

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Menu API HTTP ' + response.status);
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

            this.products = meals.concat(drinks);

            console.log('Loaded menu products:', this.products.length);
            this.setStatus('');
        } catch (error) {
            console.error('Menu fetch failed:', error);
            this.products = [];
            this.setStatus('Unable to load menu.');
        }
    }

    /* CLOUDFLARE R2 MANIFEST */

    getModelsBaseUrl() {
        let base = String(this.r2Base || '').trim().replace(/\/+$/, '');

        if (!base) return '';

        if (!/\/models$/i.test(base)) {
            base += '/models';
        }

        return base + '/';
    }

    async loadModelManifest() {
        this.availableModelIds.clear();
        this.modelManifestLoaded = false;

        const base = this.getModelsBaseUrl();
        if (!base) return;

        try {
            const response = await fetch(base + 'models.json', {
                cache: 'no-cache',
            });

            if (!response.ok) {
                throw new Error('Manifest HTTP ' + response.status);
            }

            const manifest = await response.json();

            if (!manifest || !Array.isArray(manifest.models)) {
                throw new Error('models.json must contain a models array');
            }

            for (const value of manifest.models) {
                const id = String(value || '').trim();

                if (/^[a-fA-F0-9]{24}$/.test(id)) {
                    this.availableModelIds.add(id);
                }
            }

            this.modelManifestLoaded = true;

            console.log(
                'Loaded model IDs:',
                this.availableModelIds.size
            );
        } catch (error) {
            console.error('Failed to load R2 models.json:', error);
            this.setStatus('3D previews unavailable; showing images.');
        }
    }

    getProductId(product) {
        return product && product.id ? String(product.id) : '';
    }

    getModelId(product) {
        if (!this.modelManifestLoaded || !product) return '';

        const id = this.getProductId(product);

        return this.availableModelIds.has(id) ? id : '';
    }

    getModelUrl(product) {
        const id = this.getModelId(product);

        return id
            ? this.getModelsBaseUrl() + encodeURIComponent(id) + '.glb'
            : '';
    }

    /* FILTERS */

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

        if (!categorySet.has(this.currentCategory)) {
            this.currentCategory = 'all';
        }
    }

    applyFilters() {
        this.filteredProducts = this.products.filter(product => {
            const typeMatches = product.type === this.currentType;

            const categoryMatches =
                this.currentCategory === 'all' ||
                product.category === this.currentCategory;

            const modelMatches =
                !this.only3DModels ||
                Boolean(this.getModelId(product));

            return typeMatches && categoryMatches && modelMatches;
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
        this.displayCurrentSelection(
            type === 'meal' ? 'No meals found.' : 'No drinks found.'
        );
    }

    setCategory(category) {
        this.currentCategory = category;

        this.applyFilters();
        this.displayCurrentSelection(
            'No products found in this category.'
        );
    }

    setOnly3DModels(enabled) {
        this.only3DModels = Boolean(enabled);

        this.applyFilters();

        this.displayCurrentSelection(
            'No products with 3D models in this selection.'
        );
    }

    displayCurrentSelection(emptyMessage) {
        if (this.filteredProducts.length) {
            this.showProduct(0);
            return;
        }

        // Invalidate any pending GLB request so it cannot appear later.
        this.modelRequestId++;
        this.hideActiveModel();
        this.showImageFallback('');
        this.currentProduct = null;
        this.updateUI();
        this.setStatus(emptyMessage);
    }

    /* CAROUSEL NAVIGATION */

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

    /* PRODUCT DISPLAY */

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
        this.showImageFallback(product.img);
        this.updateUI();

        const modelId = this.getModelId(product);

        if (!modelId) {
            this.setStatus(
                product.img
                    ? '3D preview unavailable; showing product image.'
                    : 'Showing placeholder image.'
            );

            this.dispatchModelReady(product, false);
            this.startRestaurantPreload();
            return;
        }

        this.setStatus('Loading 3D model...');

        try {
            const prefab = await this.ensurePrefab(product);

            // Prevent a late download from replacing a newer selection.
            if (requestId !== this.modelRequestId) return;

            this.hideActiveModel();

            const instance = this.engine.scene.instantiate(prefab);
            const root = instance.root;

            root.parent = this.displayRoot;
            this.placeModel(root);
            root.active = true;

            this.activeModelRoot = root;
            this.activeModelId = modelId;

            // A valid 3D model replaces the fallback image.
            this.hideImageFallback();
            this.setStatus('');

            this.dispatchModelReady(product, true);
        } catch (error) {
            console.error('Failed to display GLB:', modelId, error);

            if (requestId === this.modelRequestId) {
                // Re-show the product image or custom placeholder.
                this.showImageFallback(product.img);
                this.setStatus(
                    product.img
                        ? 'Showing product image.'
                        : 'Showing placeholder image.'
                );

                this.dispatchModelReady(product, false);
            }
        }

        this.startRestaurantPreload();
    }

    /* GLTF PREFAB CACHE */

    ensurePrefab(product) {
        const modelId = this.getModelId(product);

        if (!modelId) {
            return Promise.reject(
                new Error('No registered GLB for this product')
            );
        }

        if (this.modelPrefabs.has(modelId)) {
            return Promise.resolve(this.modelPrefabs.get(modelId));
        }

        if (this.modelLoads.has(modelId)) {
            return this.modelLoads.get(modelId);
        }

        const url = this.getModelUrl(product);

        console.log('Loading GLB:', modelId, url);

        const promise = this.engine.loadGLTF({ url })
            .then(prefab => {
                this.modelPrefabs.set(modelId, prefab);
                return prefab;
            })
            .finally(() => {
                this.modelLoads.delete(modelId);
            });

        this.modelLoads.set(modelId, promise);

        return promise;
    }

    /* BACKGROUND PRELOADING */

    startRestaurantPreload() {
        if (!this.modelManifestLoaded) return;

        // Queue the next two products that actually have GLBs.
        const upcoming = this.filteredProducts.slice(
            this.currentIndex + 1,
            this.currentIndex + 3
        );

        for (const product of upcoming) {
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

        this.pumpPreloadQueue();
    }

    pumpPreloadQueue() {
        if (this.preloadWorkerRunning) return;

        this.preloadWorkerRunning = true;

        const run = async () => {
            try {
                while (this.preloadQueue.length) {
                    const product = this.preloadQueue.shift();
                    const id = this.getModelId(product);

                    this.preloadQueuedIds.delete(id);

                    if (!id || this.modelPrefabs.has(id)) continue;

                    try {
                        await this.ensurePrefab(product);
                    } catch (error) {
                        console.warn(
                            'Background preload failed:',
                            id,
                            error
                        );
                    }
                }
            } finally {
                this.preloadWorkerRunning = false;

                if (this.preloadQueue.length) {
                    this.pumpPreloadQueue();
                }
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
                    available,
                },
            })
        );
    }

    /* MODEL LIFECYCLE */

    hideActiveModel() {
        this.stopRotation();

        const root = this.activeModelRoot;

        this.activeModelRoot = null;
        this.activeModelId = null;

        if (!root) return;

        try {
            root.active = false;

            if (typeof root.destroy === 'function') {
                root.destroy();
            }
        } catch (error) {
            console.warn('Could not remove previous model:', error);
        }
    }

    /* MODEL ORIENTATION AND PLACEMENT */

    applyModelOrientation(root) {
        if (!root || typeof root.setRotationLocal !== 'function') return;

        const degrees = Number(this.modelRotationXDegrees) || 0;
        const halfAngle = degrees * Math.PI / 360;

        root.setRotationLocal([
            Math.sin(halfAngle),
            0,
            0,
            Math.cos(halfAngle),
        ]);
    }

    placeModel(root) {
        if (!root) return;

        this.applyModelOrientation(root);
        root.setTranslationLocal([0, 0.01, 0]);

        const scale = this.modelScale * this.currentScaleFactor;

        root.setScalingLocal([scale, scale, scale]);
    }

    /* ROTATION */

    update(dt) {
        if (!this.isRotating || !this.activeModelRoot) return;

        const angle = this.rotateSpeed * dt * Math.PI / 180;

        this.activeModelRoot.rotateAxisAngleRadObject(
            [0, 1, 0],
            angle
        );
    }

    startRotation() {
        if (this.activeModelRoot) this.isRotating = true;
    }

    stopRotation() {
        this.isRotating = false;
    }

    /* ZOOM */

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

        const ids = {
            0.5: 'zoom-x05',
            1.0: 'zoom-x1',
            2.0: 'zoom-x2',
        };

        const activeButton = document.getElementById(ids[factor]);

        if (activeButton) activeButton.classList.add('active');
    }

    applyScaleToCurrent() {
        if (!this.activeModelRoot) return;

        const scale = this.modelScale * this.currentScaleFactor;

        this.activeModelRoot.setScalingLocal([scale, scale, scale]);
    }

    /* IMAGE FALLBACK */

    showImageFallback(url) {
        const container = document.getElementById(
            'product-image-container'
        );
        const image = document.getElementById('product-image');

        if (!container || !image) return;

        const productImage = String(url || '').trim();
        const placeholder = String(
            this.fallbackImageUrl || '/IMAGEnotfound.jpg'
        ).trim();

        image.onerror = () => {
            if (image.dataset.usingPlaceholder !== 'true' && placeholder) {
                image.dataset.usingPlaceholder = 'true';
                image.src = placeholder;
            } else {
                // Avoid an infinite onerror loop if the placeholder is missing.
                container.style.display = 'none';
                console.error(
                    'Product image and fallback image could not be loaded.'
                );
            }
        };

        image.onload = () => {
            image.dataset.usingPlaceholder = 'false';
        };

        container.style.display = 'block';

        if (productImage) {
            image.dataset.usingPlaceholder = 'false';
            image.src = productImage;
        } else if (placeholder) {
            image.dataset.usingPlaceholder = 'true';
            image.src = placeholder;
        } else {
            container.style.display = 'none';
        }
    }

    hideImageFallback() {
        const container = document.getElementById(
            'product-image-container'
        );

        if (container) container.style.display = 'none';
    }

    /* SWIPE NAVIGATION */

    setupSwipeNavigation() {
        if (this.swipeListenersInstalled) return;

        this.swipeListenersInstalled = true;
        this.swipeStart = null;

        const isUI = target => {
            return target instanceof Element && Boolean(
                target.closest(
                    '#model-ui-root, button, select, input, textarea'
                )
            );
        };

        window.addEventListener('pointerdown', event => {
            if (event.pointerType === 'mouse' && event.button !== 0) {
                this.swipeStart = null;
                return;
            }

            if (isUI(event.target)) {
                this.swipeStart = null;
                return;
            }

            this.swipeStart = {
                x: event.clientX,
                y: event.clientY,
                pointerId: event.pointerId,
            };
        }, { passive: true });

        window.addEventListener('pointerup', event => {
            if (!this.swipeStart) return;

            const start = this.swipeStart;
            this.swipeStart = null;

            if (start.pointerId !== event.pointerId) return;

            if (isUI(event.target)) return;

            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;

            if (
                Math.abs(dx) < 50 ||
                Math.abs(dx) <= Math.abs(dy) * 1.3
            ) {
                return;
            }

            if (dx < 0) {
                this.next();
            } else {
                this.prev();
            }
        }, { passive: true });

        window.addEventListener('pointercancel', () => {
            this.swipeStart = null;
        }, { passive: true });
    }

    /* STATUS AND PRICE */

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
            maximumFractionDigits: 0,
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
        } else {
            if (title) title.textContent = product.name;
            if (description) description.textContent = product.desc;
            if (price) price.textContent = this.formatPrice(product.price);

            if (counter) {
                counter.textContent =
                    (this.currentIndex + 1) +
                    ' of ' +
                    this.filteredProducts.length;
            }
        }

        document.querySelectorAll('[data-type]').forEach(button => {
            const selected = button.dataset.type === this.currentType;

            button.style.background = selected
                ? '#16a34a'
                : 'rgba(0,0,0,0.72)';
        });

        const toggle = document.getElementById('only-3d-models');

        if (toggle) {
            toggle.checked = this.only3DModels;
        }
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

    /* UI CREATION */

    createUI() {
        document.getElementById('model-ui-root')?.remove();
        document.getElementById('product-image-container')?.remove();

        // Large fallback image, positioned above the bottom controls.
        const imageContainer = document.createElement('div');

        imageContainer.id = 'product-image-container';

        imageContainer.style.cssText =
            'position:fixed;top:4%;left:50%;' +
            'transform:translateX(-50%);' +
            'z-index:9998;display:none;' +
            'width:96vw;max-width:900px;' +
            'height:58vh;max-height:650px;' +
            'border-radius:20px;overflow:hidden;' +
            'background:rgba(0,0,0,.35);' +
            'pointer-events:none;';

        const image = document.createElement('img');

        image.id = 'product-image';
        image.alt = 'Product image';

        image.style.cssText =
            'display:block;width:100%;height:100%;' +
            'object-fit:contain;object-position:center;';

        imageContainer.appendChild(image);
        document.body.appendChild(imageContainer);

        const root = document.createElement('div');

        root.id = 'model-ui-root';

        root.style.cssText =
            'position:fixed;left:0;right:0;bottom:0;' +
            'z-index:9999;pointer-events:none;' +
            'display:flex;flex-direction:column;' +
            'align-items:center;padding:8px;' +
            'padding-bottom:max(12px,env(safe-area-inset-bottom));' +
            'font-family:system-ui,sans-serif;box-sizing:border-box;';

        const filterPanel = document.createElement('div');

        filterPanel.style.cssText =
            'pointer-events:auto;width:100%;max-width:700px;' +
            'margin-bottom:6px;display:flex;gap:6px;' +
            'overflow-x:auto;align-items:center;';

        const typeButtons = document.createElement('div');

        typeButtons.style.cssText =
            'display:flex;gap:6px;flex-shrink:0;';

        const makeButton = (label, action, extraClass = '') => {
            const button = document.createElement('button');

            button.textContent = label;
            button.className = extraClass;

            button.style.cssText =
                'border:0;padding:9px 12px;border-radius:12px;' +
                'background:rgba(0,0,0,.82);color:white;' +
                'font-size:13px;font-weight:600;cursor:pointer;' +
                'touch-action:manipulation;';

            button.onclick = action;

            return button;
        };

        const mealsButton = makeButton(
            'Meals',
            () => this.setType('meal')
        );

        mealsButton.dataset.type = 'meal';

        const drinksButton = makeButton(
            'Drinks',
            () => this.setType('drink')
        );

        drinksButton.dataset.type = 'drink';

        typeButtons.append(mealsButton, drinksButton);
        filterPanel.appendChild(typeButtons);

        const categorySelect = document.createElement('select');

        categorySelect.id = 'category-select';

        categorySelect.style.cssText =
            'padding:10px;border:0;border-radius:12px;' +
            'background:rgba(0,0,0,.82);color:white;' +
            'font-size:13px;max-width:180px;flex-shrink:0;';

        categorySelect.onchange = () => {
            this.setCategory(categorySelect.value);
        };

        filterPanel.appendChild(categorySelect);

        // Toggle: all products versus products with registered GLBs.
        const modelFilterLabel = document.createElement('label');

        modelFilterLabel.style.cssText =
            'display:flex;align-items:center;gap:6px;' +
            'flex-shrink:0;color:white;font-size:12px;' +
            'white-space:nowrap;cursor:pointer;' +
            'background:rgba(0,0,0,.82);padding:9px;' +
            'border-radius:12px;';

        const modelFilterToggle = document.createElement('input');

        modelFilterToggle.type = 'checkbox';
        modelFilterToggle.id = 'only-3d-models';
        modelFilterToggle.checked = this.only3DModels;

        modelFilterToggle.style.cssText =
            'width:17px;height:17px;accent-color:#16a34a;';

        modelFilterToggle.onchange = () => {
            this.setOnly3DModels(modelFilterToggle.checked);
        };

        const modelFilterText = document.createElement('span');

        modelFilterText.textContent = '3D models only';

        modelFilterLabel.append(
            modelFilterToggle,
            modelFilterText
        );

        filterPanel.appendChild(modelFilterLabel);
        root.appendChild(filterPanel);

        const panel = document.createElement('div');

        panel.id = 'product-panel';

        panel.style.cssText =
            'pointer-events:none;width:100%;max-width:520px;' +
            'background:rgba(0,0,0,.80);color:white;' +
            'border-radius:14px;padding:10px 14px;' +
            'margin-bottom:5px;box-sizing:border-box;';

        const title = document.createElement('div');

        title.id = 'product-title';

        title.style.cssText =
            'font-size:19px;font-weight:700;margin-bottom:3px;' +
            'overflow-wrap:anywhere;';

        const description = document.createElement('div');

        description.id = 'product-description';

        description.style.cssText =
            'font-size:12px;line-height:1.35;margin-bottom:5px;' +
            'max-height:48px;overflow-y:auto;';

        const price = document.createElement('div');

        price.id = 'product-price';

        price.style.cssText =
            'font-size:20px;font-weight:700;color:#4ade80;';

        const counter = document.createElement('div');

        counter.id = 'product-counter';

        counter.style.cssText =
            'font-size:11px;opacity:.8;margin-top:3px;';

        panel.append(title, description, price, counter);
        root.appendChild(panel);

        const status = document.createElement('div');

        status.id = 'menu-status';

        status.style.cssText =
            'color:white;font-size:11px;margin-bottom:5px;' +
            'min-height:14px;text-shadow:0 2px 5px black;';

        root.appendChild(status);

        const controls = document.createElement('div');

        controls.style.cssText =
            'pointer-events:auto;display:flex;gap:6px;' +
            'flex-wrap:wrap;justify-content:center;' +
            'max-width:700px;';

        controls.appendChild(
            makeButton('◀ Prev', () => this.prev())
        );

        controls.appendChild(
            makeButton('Next ▶', () => this.next())
        );

        const rotateButton = makeButton('🔄 Hold to Rotate', () => {});

        rotateButton.addEventListener('pointerdown', event => {
            event.preventDefault();
            this.startRotation();

            if (rotateButton.setPointerCapture) {
                rotateButton.setPointerCapture(event.pointerId);
            }
        });

        rotateButton.addEventListener(
            'pointerup',
            () => this.stopRotation()
        );

        rotateButton.addEventListener(
            'pointercancel',
            () => this.stopRotation()
        );

        rotateButton.addEventListener(
            'lostpointercapture',
            () => this.stopRotation()
        );

        controls.appendChild(rotateButton);

        controls.appendChild(
            makeButton('Zoom −', () => this.setZoom(0.5), 'zoom-btn')
        );

        controls.lastChild.id = 'zoom-x05';

        controls.appendChild(
            makeButton('Zoom 1×', () => this.setZoom(1.0), 'zoom-btn')
        );

        controls.lastChild.id = 'zoom-x1';

        controls.appendChild(
            makeButton('Zoom +', () => this.setZoom(2.0), 'zoom-btn')
        );

        controls.lastChild.id = 'zoom-x2';

        root.appendChild(controls);
        document.body.appendChild(root);

        this.setupSwipeNavigation();
        this.updateFilterUI();
        this.updateUI();
    }
}
