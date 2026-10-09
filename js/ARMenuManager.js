import {Component, Property} from '@wonderlandengine/api';

export class ARMenuManager extends Component {
    static TypeName = 'ar-menu-manager';

    static Properties = {
        apiBase: Property.string('https://api.abincii.com/api'),

        r2Base: Property.string(
            'https://https://pub-5f00c6484f634858a427e577f435334d.r2.dev/models/'
        ),

        displayRoot: Property.object(),

        modelScale: Property.float(0.3),

        rotateSpeed: Property.float(90.0),
    };

    init() {
        /* ================================
         * PRODUCT DATA
         * ================================ */

        this.products = [];
        this.filteredProducts = [];
        this.categories = [];

        /* ================================
         * FILTER STATE
         * ================================ */

        this.currentType = 'all';
        this.currentCategory = 'all';

        /* ================================
         * CURRENT PRODUCT
         * ================================ */

        this.currentIndex = 0;
        this.currentProduct = null;

        /* ================================
         * MODEL STATE
         * ================================ */

        this.modelPool = new Map();
        this.activeModelRoot = null;

        /*
         * Prevent multiple requests for
         * the same model.
         */
        this.loading = new Set();

        /*
         * Used to prevent an old async GLB
         * request from becoming active after
         * the user has already moved to another
         * product.
         */
        this.modelRequestId = 0;

        /* ================================
         * ROTATION
         * ================================ */

        this.isRotating = false;

        /* ================================
         * ZOOM
         * ================================ */

        this.currentScaleFactor = 1.0;

        this.zoomSettings = {
            0.5: {
                scale: 0.5,
                fov: 85
            },

            1.0: {
                scale: 1.0,
                fov: 60
            },

            2.0: {
                scale: 2.0,
                fov: 75
            }
        };
    }

    async start() {
        /*
         * Create UI immediately.
         */
        this.createUI();

        /*
         * Expose manager to browser UI.
         */
        window.arMenu = this;

        /*
         * Read QR parameters.
         */
        const params = new URLSearchParams(
            window.location.search
        );

        this.restaurantId = params.get('restaurant');
        this.tableId = params.get('table');

        if (!this.restaurantId) {
            console.error(
                'ARMenuManager: No restaurant ID found in URL.'
            );

            this.setStatus(
                'No restaurant ID was provided.'
            );

            return;
        }

        console.log(
            'Restaurant:',
            this.restaurantId
        );

        console.log(
            'Table:',
            this.tableId
        );

        /*
         * Start with normal zoom.
         */
        this.setZoom(1.0);

        /*
         * Fetch menu.
         */
        await this.fetchMenu(this.restaurantId);

        /*
         * Build category list.
         */
        this.buildCategories();

        /*
         * Apply initial filters.
         */
        this.applyFilters();

        /*
         * Show first product.
         */
        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
        } else {
            this.setStatus(
                'No menu items were found.'
            );
        }
    }

    /* =========================================
     * FETCH MENU
     * ========================================= */

    async fetchMenu(restaurantId) {
        try {
            this.setStatus('Loading menu...');

            const url =
                `${this.apiBase}/restaurants/menu` +
                `?restaurant=${encodeURIComponent(restaurantId)}`;

            console.log(
                'Fetching menu:',
                url
            );

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(
                    'Backend returned success=false'
                );
            }

            /*
             * Convert meals into common product format.
             */
            const meals = (data.meal || []).map(meal => ({
                type: 'meal',

                id: meal._id,

                name: meal.mealName || 'Unnamed Meal',

                desc: meal.desc || '',

                price: meal.price,

                category:
                    meal.category ||
                    'Uncategorized',

                img: meal.mealImg || '',

                raw: meal
            }));

            /*
             * Convert drinks into common product format.
             */
            const drinks = (data.drink || []).map(drink => ({
                type: 'drink',

                id: drink._id,

                name: drink.drinkName || 'Unnamed Drink',

                desc: drink.desc || '',

                price: drink.price,

                category:
                    drink.category ||
                    'Uncategorized',

                img: drink.drinkImg || '',

                raw: drink
            }));

            /*
             * Combine everything.
             */
            this.products = [
                ...meals,
                ...drinks
            ];

            console.log(
                `Loaded ${this.products.length} products`
            );

            this.setStatus('');

        } catch (error) {
            console.error(
                'ARMenuManager: Failed to fetch menu:',
                error
            );

            this.products = [];

            this.setStatus(
                'Unable to load menu.'
            );
        }
    }

    /* =========================================
     * CATEGORY GENERATION
     * ========================================= */

    buildCategories() {
        const categorySet = new Set();

        for (const product of this.products) {
            if (product.category) {
                categorySet.add(product.category);
            }
        }

        this.categories = [
            'all',
            ...Array.from(categorySet).sort()
        ];
    }

    /* =========================================
     * FILTERING
     * ========================================= */

    applyFilters() {
        this.filteredProducts =
            this.products.filter(product => {

                const typeMatches =
                    this.currentType === 'all' ||
                    product.type === this.currentType;

                const categoryMatches =
                    this.currentCategory === 'all' ||
                    product.category === this.currentCategory;

                return (
                    typeMatches &&
                    categoryMatches
                );
            });

        this.currentIndex = 0;

        this.updateFilterUI();

        this.updateUI();
    }

    setType(type) {
        this.currentType = type;

        /*
         * When changing meal/drink,
         * reset category.
         */
        this.currentCategory = 'all';

        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
        } else {
            this.hideActiveModel();

            this.currentProduct = null;

            this.updateUI();
        }
    }

    setCategory(category) {
        this.currentCategory = category;

        this.applyFilters();

        if (this.filteredProducts.length > 0) {
            this.showProduct(0);
        } else {
            this.hideActiveModel();

            this.currentProduct = null;

            this.updateUI();
        }
    }

    /* =========================================
     * NEXT / PREVIOUS
     * ========================================= */

    next() {
        if (this.filteredProducts.length === 0) {
            return;
        }

        this.currentIndex =
            (this.currentIndex + 1) %
            this.filteredProducts.length;

        this.showProduct(
            this.currentIndex
        );
    }

    prev() {
        if (this.filteredProducts.length === 0) {
            return;
        }

        this.currentIndex =
            (
                this.currentIndex -
                1 +
                this.filteredProducts.length
            ) %
            this.filteredProducts.length;

        this.showProduct(
            this.currentIndex
        );
    }

    /* =========================================
     * SHOW PRODUCT
     * ========================================= */

    async showProduct(index) {
        if (
            this.filteredProducts.length === 0
        ) {
            return;
        }

        /*
         * Clamp index.
         */
        index = Math.max(
            0,
            Math.min(
                index,
                this.filteredProducts.length - 1
            )
        );

        this.currentIndex = index;

        this.currentProduct =
            this.filteredProducts[index];

        /*
         * Update text immediately.
         */
        this.updateUI();

        /*
         * Hide old model.
         */
        this.hideActiveModel();

        /*
         * Hide image fallback.
         */
        this.hideImageFallback();

        /*
         * New async request ID.
         */
        const requestId =
            ++this.modelRequestId;

        const product =
            this.currentProduct;

        const nameKey =
            this.sanitizeName(product.name);

        /*
         * Check cached model.
         */
        const cached =
            this.modelPool.get(nameKey);

        if (cached) {
            /*
             * If user changed product while
             * loading another model, don't
             * activate stale model.
             */
            if (
                requestId !== this.modelRequestId
            ) {
                return;
            }

            cached.root.active = true;

            this.activeModelRoot =
                cached.root;

            this.placeModel(
                cached.root
            );

            this.applyScaleToCurrent();

            this.setStatus('');

            return;
        }

        /*
         * Show loading state.
         */
        this.setStatus(
            'Loading 3D model...'
        );

        /*
         * Prevent duplicate request.
         */
        if (this.loading.has(nameKey)) {
            return;
        }

        this.loading.add(nameKey);

        try {
            const url =
                `${this.r2Base}${nameKey}.glb`;

            console.log(
                'Loading GLB:',
                url
            );

            /*
             * Runtime GLTF loading.
             */
            const prefab =
                await this.engine.loadGLTF({
                    file: url
                });

            /*
             * User may have selected another
             * product while the GLB was loading.
             */
            if (
                requestId !== this.modelRequestId
            ) {
                return;
            }

            /*
             * Instantiate GLB.
             */
            const result =
                this.engine.scene.instantiate(
                    prefab
                );

            const root =
                result.root;

            /*
             * Parent to AR display root.
             */
            root.parent =
                this.displayRoot;

            /*
             * Set initial local transform.
             */
            root.setTranslationLocal([
                0,
                0.1,
                0
            ]);

            root.setScalingLocal([
                this.modelScale,
                this.modelScale,
                this.modelScale
            ]);

            root.active = true;

            /*
             * Store in pool.
             */
            this.modelPool.set(
                nameKey,
                {
                    root,
                    prefab
                }
            );

            this.activeModelRoot =
                root;

            /*
             * Apply selected zoom.
             */
            this.applyScaleToCurrent();

            this.setStatus('');

        } catch (error) {
            /*
             * GLB doesn't exist or couldn't
             * be downloaded.
             */
            console.warn(
                `No GLB available for "${nameKey}".`,
                error
            );

            /*
             * Only show fallback if this is
             * still the current product.
             */
            if (
                requestId === this.modelRequestId
            ) {
                this.showImageFallback(
                    product.img
                );

                this.setStatus('');
            }

        } finally {
            this.loading.delete(nameKey);
        }
    }

    /* =========================================
     * MODEL VISIBILITY
     * ========================================= */

    hideActiveModel() {
        if (!this.activeModelRoot) {
            return;
        }

        this.activeModelRoot.active =
            false;

        this.activeModelRoot = null;
    }

    /* =========================================
     * MODEL PLACEMENT
     * ========================================= */

    placeModel(root) {
        if (!root) {
            return;
        }

        root.setTranslationLocal([
            0,
            0.1,
            0
        ]);
    }

    /* =========================================
     * ROTATION
     * ========================================= */

    update(dt) {
        if (!this.isRotating) {
            return;
        }

        if (!this.activeModelRoot) {
            return;
        }

        const angle =
            this.rotateSpeed *
            dt *
            (Math.PI / 180);

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
        const setting =
            this.zoomSettings[factor];

        if (!setting) {
            return;
        }

        this.currentScaleFactor =
            setting.scale;

        this.applyScaleToCurrent();

        /*
         * Main Wonderland view.
         */
        const view =
            this.engine.scene.mainView;

        if (view) {
            view.fov =
                setting.fov;
        }

        /*
         * Update button state.
         */
        document
            .querySelectorAll('.zoom-btn')
            .forEach(button => {
                button.classList.remove(
                    'active'
                );
            });

        let activeId = 'zoom-x1';

        if (factor === 0.5) {
            activeId = 'zoom-x05';
        }

        if (factor === 2.0) {
            activeId = 'zoom-x2';
        }

        document
            .getElementById(activeId)
            ?.classList.add('active');
    }

    applyScaleToCurrent() {
        if (!this.activeModelRoot) {
            return;
        }

        const scale =
            this.modelScale *
            this.currentScaleFactor;

        this.activeModelRoot.setScalingLocal([
            scale,
            scale,
            scale
        ]);
    }

    /* =========================================
     * IMAGE FALLBACK
     * ========================================= */

    showImageFallback(imgUrl) {
        const container =
            document.getElementById(
                'product-image-container'
            );

        const img =
            document.getElementById(
                'product-image'
            );

        if (!container || !img) {
            return;
        }

        if (!imgUrl) {
            container.style.display =
                'none';

            return;
        }

        img.src = imgUrl;

        container.style.display =
            'block';
    }

    hideImageFallback() {
        const container =
            document.getElementById(
                'product-image-container'
            );

        if (container) {
            container.style.display =
                'none';
        }
    }

    /* =========================================
     * NAME SANITIZATION
     * ========================================= */

    sanitizeName(name) {
        return String(name || '')
            .toLowerCase()
            .trim()
            .replace(/&/g, 'and')
            .replace(/\+/g, 'plus')
            .replace(/['’]/g, '')
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-');
    }

    /* =========================================
     * PRICE FORMATTING
     * ========================================= */

    formatPrice(price) {
        if (
            price === null ||
            price === undefined ||
            price === ''
        ) {
            return '—';
        }

        const number =
            Number(price);

        if (Number.isNaN(number)) {
            return String(price);
        }

        return new Intl.NumberFormat(
            'en-NG',
            {
                style: 'currency',
                currency: 'NGN',
                maximumFractionDigits: 0
            }
        ).format(number);
    }

    /* =========================================
     * UI
     * ========================================= */

    createUI() {
        /*
         * Remove old UI if present.
         */
        document
            .getElementById(
                'model-ui-root'
            )
            ?.remove();

        document
            .getElementById(
                'product-image-container'
            )
            ?.remove();

        /* =====================================
         * IMAGE FALLBACK
         * ===================================== */

        const imageContainer =
            document.createElement('div');

        imageContainer.id =
            'product-image-container';

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

            box-shadow:
                0 12px 40px rgba(0,0,0,0.5);

            pointer-events: none;
        `;

        const image =
            document.createElement('img');

        image.id =
            'product-image';

        image.style.cssText = `
            width: 100%;
            height: auto;

            max-height: 55vh;

            object-fit: contain;

            display: block;
        `;

        imageContainer.appendChild(image);

        document.body.appendChild(
            imageContainer
        );

        /* =====================================
         * MAIN UI ROOT
         * ===================================== */

        const root =
            document.createElement('div');

        root.id =
            'model-ui-root';

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

            padding:
                0 12px
                max(16px, env(safe-area-inset-right))
                max(20px, env(safe-area-inset-bottom))
                max(16px, env(safe-area-inset-left));

            font-family:
                system-ui,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Roboto,
                sans-serif;

            box-sizing: border-box;
        `;

        /* =====================================
         * FILTER PANEL
         * ===================================== */

        const filterPanel =
            document.createElement('div');

        filterPanel.id =
            'menu-filter-panel';

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
        `;

        /* TYPE BUTTONS */

        const typeButtons =
            document.createElement('div');

        typeButtons.style.cssText = `
            display: flex;
            gap: 6px;
            flex-shrink: 0;
        `;

        const createFilterButton =
            (label, value) => {

                const button =
                    document.createElement(
                        'button'
                    );

                button.textContent =
                    label;

                button.dataset.type =
                    value;

                button.style.cssText = `
                    border: none;

                    padding:
                        9px 13px;

                    border-radius:
                        999px;

                    background:
                        rgba(0,0,0,0.72);

                    color: white;

                    font-size: 13px;

                    font-weight: 600;

                    cursor: pointer;

                    backdrop-filter:
                        blur(8px);

                    -webkit-backdrop-filter:
                        blur(8px);

                    white-space: nowrap;

                    touch-action: manipulation;
                `;

                button.onclick = () => {
                    this.setType(value);
                };

                return button;
            };

        typeButtons.appendChild(
            createFilterButton(
                'All',
                'all'
            )
        );

        typeButtons.appendChild(
            createFilterButton(
                'Meals',
                'meal'
            )
        );

        typeButtons.appendChild(
            createFilterButton(
                'Drinks',
                'drink'
            )
        );

        filterPanel.appendChild(
            typeButtons
        );

        /* CATEGORY SELECT */

        const categorySelect =
            document.createElement(
                'select'
            );

        categorySelect.id =
            'category-select';

        categorySelect.style.cssText = `
            border: none;

            padding:
                9px 12px;

            border-radius:
                999px;

            background:
                rgba(0,0,0,0.72);

            color: white;

            font-size: 13px;

            font-weight: 600;

            outline: none;

            max-width: 180px;

            backdrop-filter:
                blur(8px);

            -webkit-backdrop-filter:
                blur(8px);
        `;

        categorySelect.onchange = () => {
            this.setCategory(
                categorySelect.value
            );
        };

        filterPanel.appendChild(
            categorySelect
        );

        root.appendChild(
            filterPanel
        );

        /* =====================================
         * PRODUCT INFORMATION
         * ===================================== */

        const panel =
            document.createElement('div');

        panel.id =
            'product-panel';

        panel.style.cssText = `
            pointer-events: none;

            width: 100%;

            max-width: 420px;

            background:
                rgba(0,0,0,0.72);

            backdrop-filter:
                blur(10px);

            -webkit-backdrop-filter:
                blur(10px);

            border-radius:
                16px;

            padding:
                14px 18px;

            margin-bottom:
                10px;

            color: white;

            box-shadow:
                0 8px 24px
                rgba(0,0,0,0.35);

            box-sizing: border-box;
        `;

        const title =
            document.createElement('div');

        title.id =
            'product-title';

        title.style.cssText = `
            font-size: 20px;

            font-weight: 700;

            margin-bottom: 5px;

            line-height: 1.25;
        `;

        const description =
            document.createElement('div');

        description.id =
            'product-description';

        description.style.cssText = `
            font-size: 13px;

            opacity: 0.9;

            line-height: 1.4;

            margin-bottom: 8px;
        `;

        const price =
            document.createElement('div');

        price.id =
            'product-price';

        price.style.cssText = `
            font-size: 21px;

            font-weight: 700;

            color: #4ade80;
        `;

        const counter =
            document.createElement('div');

        counter.id =
            'product-counter';

        counter.style.cssText = `
            font-size: 11px;

            opacity: 0.65;

            margin-top: 5px;
        `;

        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(price);
        panel.appendChild(counter);

        root.appendChild(panel);

        /* =====================================
         * STATUS
         * ===================================== */

        const status =
            document.createElement('div');

        status.id =
            'menu-status';

        status.style.cssText = `
            color: white;

            font-size: 12px;

            margin-bottom: 6px;

            text-shadow:
                0 2px 5px black;

            min-height: 16px;
        `;

        root.appendChild(status);

        /* =====================================
         * BUTTON ROW
         * ===================================== */

        const buttons =
            document.createElement('div');

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

            padding:
                11px 14px;

            font-size: 13px;

            font-weight: 600;

            border-radius: 12px;

            border: none;

            background:
                rgba(0,0,0,0.75);

            color: white;

            backdrop-filter:
                blur(6px);

            -webkit-backdrop-filter:
                blur(6px);

            cursor: pointer;

            box-shadow:
                0 4px 14px
                rgba(0,0,0,0.35);

            user-select: none;

            -webkit-user-select: none;

            touch-action: manipulation;

            min-height: 42px;
        `;

        /* PREVIOUS */

        const prev =
            document.createElement('button');

        prev.textContent =
            '◀ Prev';

        prev.style.cssText =
            buttonStyle;

        prev.onclick = () => {
            this.prev();
        };

        /* ROTATE */

        const rotate =
            document.createElement('button');

        rotate.textContent =
            '🔄 Hold to Rotate';

        rotate.style.cssText =
            buttonStyle;

        rotate.addEventListener(
            'mousedown',
            event => {
                event.preventDefault();

                this.startRotation();
            }
        );

        rotate.addEventListener(
            'mouseup',
            () => {
                this.stopRotation();
            }
        );

        rotate.addEventListener(
            'mouseleave',
            () => {
                this.stopRotation();
            }
        );

        rotate.addEventListener(
            'touchstart',
            event => {
                event.preventDefault();

                this.startRotation();
            },
            {
                passive: false
            }
        );

        rotate.addEventListener(
            'touchend',
            () => {
                this.stopRotation();
            }
        );

        rotate.addEventListener(
            'touchcancel',
            () => {
                this.stopRotation();
            }
        );

        /* NEXT */

        const next =
            document.createElement('button');

        next.textContent =
            'Next ▶';

        next.style.cssText =
            buttonStyle;

        next.onclick = () => {
            this.next();
        };

        buttons.appendChild(prev);
        buttons.appendChild(rotate);
        buttons.appendChild(next);

        root.appendChild(buttons);

        /* =====================================
         * ZOOM ROW
         * ===================================== */

        const zoomRow =
            document.createElement('div');

        zoomRow.style.cssText = `
            display: flex;

            gap: 7px;

            pointer-events: auto;

            margin-top: 8px;

            justify-content: center;
        `;

        const createZoomButton =
            (id, label, factor) => {

                const button =
                    document.createElement(
                        'button'
                    );

                button.id = id;

                button.className =
                    'zoom-btn';

                button.textContent =
                    label;

                button.style.cssText =
                    buttonStyle;

                button.onclick = () => {
                    this.setZoom(factor);
                };

                return button;
            };

        zoomRow.appendChild(
            createZoomButton(
                'zoom-x05',
                '×0.5',
                0.5
            )
        );

        zoomRow.appendChild(
            createZoomButton(
                'zoom-x1',
                '×1',
                1.0
            )
        );

        zoomRow.appendChild(
            createZoomButton(
                'zoom-x2',
                '×2',
                2.0
            )
        );

        root.appendChild(
            zoomRow
        );

        document.body.appendChild(root);

        /*
         * Populate category selector.
         */
        this.updateFilterUI();
    }

    /* =========================================
     * UPDATE FILTER UI
     * ========================================= */

    updateFilterUI() {
        const select =
            document.getElementById(
                'category-select'
            );

        if (!select) {
            return;
        }

        select.innerHTML = '';

        for (
            const category of this.categories
        ) {
            const option =
                document.createElement(
                    'option'
                );

            option.value =
                category;

            option.textContent =
                category === 'all'
                    ? 'All Categories'
                    : category;

            option.selected =
                category ===
                this.currentCategory;

            select.appendChild(
                option
            );
        }

        /*
         * Update type button appearance.
         */
        document
            .querySelectorAll(
                '[data-type]'
            )
            .forEach(button => {

                const active =
                    button.dataset.type ===
                    this.currentType;

                if (active) {
                    button.style.background =
                        'rgba(74,222,128,0.85)';
                    button.style.color =
                        '#06140b';
                } else {
                    button.style.background =
                        'rgba(0,0,0,0.72)';
                    button.style.color =
                        'white';
                }
            });
    }

    /* =========================================
     * UPDATE PRODUCT UI
     * ========================================= */

    updateUI() {
        const title =
            document.getElementById(
                'product-title'
            );

        const description =
            document.getElementById(
                'product-description'
            );

        const price =
            document.getElementById(
                'product-price'
            );

        const counter =
            document.getElementById(
                'product-counter'
            );

        if (
            !title ||
            !description ||
            !price ||
            !counter
        ) {
            return;
        }

        if (!this.currentProduct) {
            title.textContent =
                '';

            description.textContent =
                '';

            price.textContent =
                '';

            counter.textContent =
                '';

            return;
        }

        title.textContent =
            this.currentProduct.name;

        description.textContent =
            this.currentProduct.desc;

        price.textContent =
            this.formatPrice(
                this.currentProduct.price
            );

        counter.textContent =
            `${this.currentIndex + 1} / ` +
            `${this.filteredProducts.length}`;

        /*
         * Notify any external UI if needed.
         */
        window.dispatchEvent(
            new CustomEvent(
                'armenu-update',
                {
                    detail: {
                        product:
                            this.currentProduct,

                        index:
                            this.currentIndex,

                        total:
                            this.filteredProducts.length,

                        categories:
                            this.categories,

                        type:
                            this.currentType,

                        category:
                            this.currentCategory
                    }
                }
            )
        );
    }

    /* =========================================
     * STATUS
     * ========================================= */

    setStatus(message) {
        const status =
            document.getElementById(
                'menu-status'
            );

        if (status) {
            status.textContent =
                message || '';
        }
    }
}