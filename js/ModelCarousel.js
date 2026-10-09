import {Component, Property} from '@wonderlandengine/api';

export class ModelCarousel extends Component {
    static TypeName = 'model-carousel';

    static Properties = {
        model0: Property.object(),
        model1: Property.object(),
        model2: Property.object(),
        model3: Property.object(),
        model4: Property.object(),
        model5: Property.object(),
        model6: Property.object(),
        startIndex: Property.int(0),
        rotateSpeed: Property.float(90.0),
    };

    init() {
        this.models = [];
        this.currentIndex = 0;
        this.isRotating = false;

        // Current zoom multiplier (relative to each model's initial scale)
        this.currentScaleFactor = 1.0;

        // Scale factor → FOV mapping
        // x1 → FOV 60°, x2 → FOV 75°, x0.5 → FOV 85°
        this.zoomSettings = {
            0.5: { scale: 0.5, fov: 85 },
            1.0: { scale: 1.0, fov: 60 },
            2.0: { scale: 2.0, fov: 75 },
        };

        // Will store [sx, sy, sz] for every model (captured once in start())
        this.initialScales = [];

        // ===== 7 Products =====
        this.products = [
            {
                title: 'Isi Azu',
                description: 'Roasted catfish with sauce.',
                price: '₦14,500',
                image: null
            },
            {
                title: 'Nkwobi',
                description: 'cooked cow foot with sauce.',
                price: '₦12,900',
                image: null
            },
            {
                title: 'Odu Azu',
                description: 'Roasted catfish tail.',
                price: '₦12,000',
                image: null
            },
            {
                title: 'Abacha',
                description: 'African salad with fish.',
                price: '₦18,500',
                image: null
            },
            {
                title: 'Isiewu',
                description: 'Goat head with spice.',
                price: '₦15,000',
                image: null
            },
            {
                title: 'White rice and stew',
                description: 'white rice with chicken and tomoato stew.',
                price: '₦12,000',
                image: 'images/wtrice.JPG'
            },
            {
                title: 'Jollof rice',
                description: 'jollof and chicken.',
                price: '₦12,500',
                image: 'images/jolof.JPG'
            }
        ];
    }

    start() {
        this.models = [
            this.model0, this.model1, this.model2,
            this.model3, this.model4, this.model5, this.model6
        ];

        // Capture each model's original local scale so we can multiply later
        this.initialScales = this.models.map(m => {
            if (!m) return [1, 1, 1];
            const s = new Float32Array(3);
            m.getScalingLocal(s);
            return [s[0], s[1], s[2]];
        });

        this.currentIndex = Math.max(0, Math.min(this.startIndex, this.products.length - 1));
        this.createUI();
        this.showProduct(this.currentIndex);

        // Apply default zoom (x1 / FOV 60) on start
        this.setZoom(1.0);
    }

    update(dt) {
        if (!this.isRotating) return;

        const model = this.models[this.currentIndex];
        if (!model) return;

        const angle = (this.rotateSpeed * dt) * (Math.PI / 180);
        model.rotateAxisAngleRadObject([0, 1, 0], angle);
    }

    /** Apply current scale factor to the currently visible model */
    applyScaleToCurrent() {
        const model = this.models[this.currentIndex];
        if (!model) return;

        const base = this.initialScales[this.currentIndex] || [1, 1, 1];
        const f = this.currentScaleFactor;
        model.setScalingLocal([
            base[0] * f,
            base[1] * f,
            base[2] * f
        ]);
    }

    /** Set both object scale multiplier and camera FOV */
    setZoom(factor) {
        const setting = this.zoomSettings[factor];
        if (!setting) return;

        this.currentScaleFactor = setting.scale;
        this.applyScaleToCurrent();

        // Change FOV on the main (non-XR) view
        const view = this.engine.scene.mainView;
        if (view) {
            view.fov = setting.fov;
        }
    }

    createUI() {
        const old = document.getElementById('model-ui-root');
        if (old) old.remove();

        // ===== Main UI Root (bottom) =====
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
            padding: 0 16px 30px;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        // ===== Centered 2D Image (middle of screen) =====
        const imageContainer = document.createElement('div');
        imageContainer.id = 'product-image-container';
        imageContainer.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9998;
            display: none;
            width: 95%;
            max-width: 900px;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 12px 40px rgba(0,0,0,0.5);
            pointer-events: none;
        `;

        const img = document.createElement('img');
        img.id = 'product-image';
        img.style.cssText = `
            width: 100%;
            height: auto;
            display: block;
            background: #111;
        `;
        imageContainer.appendChild(img);
        document.body.appendChild(imageContainer);

        // ===== Product Info Panel =====
        const panel = document.createElement('div');
        panel.id = 'product-panel';
        panel.style.cssText = `
            pointer-events: none;
            width: 100%;
            max-width: 420px;
            background: rgba(0, 0, 0, 0.72);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 18px 20px;
            margin-bottom: 18px;
            color: white;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        `;

        const title = document.createElement('div');
        title.id = 'product-title';
        title.style.cssText = `font-size: 20px; font-weight: 700; margin-bottom: 6px; line-height: 1.25;`;

        const description = document.createElement('div');
        description.id = 'product-description';
        description.style.cssText = `font-size: 14px; opacity: 0.9; line-height: 1.4; margin-bottom: 12px;`;

        const price = document.createElement('div');
        price.id = 'product-price';
        price.style.cssText = `font-size: 22px; font-weight: 700; color: #4ade80;`;

        panel.appendChild(title);
        panel.appendChild(description);
        panel.appendChild(price);

        // ===== Buttons =====
        const buttons = document.createElement('div');
        buttons.style.cssText = `display: flex; gap: 10px; pointer-events: none; flex-wrap: wrap; justify-content: center;`;

        const btnStyle = `
            pointer-events: auto;
            padding: 12px 18px;
            font-size: 14px;
            font-weight: 600;
            border-radius: 12px;
            border: none;
            background: rgba(0, 0, 0, 0.75);
            color: white;
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
        `;

        // Navigation
        const prevBtn = document.createElement('button');
        prevBtn.textContent = '◀ Prev';
        prevBtn.style.cssText = btnStyle;
        prevBtn.onclick = () => this.prev();

        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Next ▶';
        nextBtn.style.cssText = btnStyle;
        nextBtn.onclick = () => this.next();

        // Rotate (hold)
        const rotateBtn = document.createElement('button');
        rotateBtn.textContent = '🔄 Hold to Rotate';
        rotateBtn.style.cssText = btnStyle;

        rotateBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.isRotating = true;
        });
        rotateBtn.addEventListener('mouseup', () => this.isRotating = false);
        rotateBtn.addEventListener('mouseleave', () => this.isRotating = false);

        rotateBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.isRotating = true;
        }, { passive: false });
        rotateBtn.addEventListener('touchend', () => this.isRotating = false);
        rotateBtn.addEventListener('touchcancel', () => this.isRotating = false);

        // ===== Scale / Zoom buttons =====
        const makeZoomBtn = (label, factor) => {
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.style.cssText = btnStyle;
            btn.onclick = () => this.setZoom(factor);
            return btn;
        };

        const zoom05Btn = makeZoomBtn('x0.5', 0.5);
        const zoom1Btn  = makeZoomBtn('x1',   1.0);
        const zoom2Btn  = makeZoomBtn('x2',   2.0);

        // Order: Prev | Rotate | Next | x0.5 | x1 | x2
        buttons.appendChild(prevBtn);
        buttons.appendChild(rotateBtn);
        buttons.appendChild(nextBtn);
        buttons.appendChild(zoom05Btn);
        buttons.appendChild(zoom1Btn);
        buttons.appendChild(zoom2Btn);

        root.appendChild(panel);
        root.appendChild(buttons);
        document.body.appendChild(root);
    }

    showProduct(index) {
        const product = this.products[index];
        if (!product) return;

        document.getElementById('product-title').textContent = product.title;
        document.getElementById('product-description').textContent = product.description;
        document.getElementById('product-price').textContent = product.price;

        const imageContainer = document.getElementById('product-image-container');
        const img = document.getElementById('product-image');

        // Hide all 3D models first
        this.models.forEach(m => {
            if (m) m.active = false;
        });

        const has3DModel = this.models[index] != null;

        if (has3DModel) {
            this.models[index].active = true;
            imageContainer.style.display = 'none';

            // Keep the currently selected zoom level when switching products
            this.applyScaleToCurrent();
        } else {
            if (product.image) {
                img.src = product.image;
                imageContainer.style.display = 'block';
            } else {
                imageContainer.style.display = 'none';
            }
        }
    }

    next() {
        this.currentIndex = (this.currentIndex + 1) % this.products.length;
        this.showProduct(this.currentIndex);
    }

    prev() {
        this.currentIndex = (this.currentIndex - 1 + this.products.length) % this.products.length;
        this.showProduct(this.currentIndex);
    }
}