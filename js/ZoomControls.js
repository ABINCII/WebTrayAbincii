import {Component, Property} from '@wonderlandengine/api';

export class ZoomControls extends Component {
    static TypeName = 'zoom-controls';

    static Properties = {
        camera: Property.object(),          // the AR Camera / View object
        defaultFov: Property.float(60),
    };

    start() {
        this.view = this.camera.getComponent('view');
        if (!this.view) {
            console.error('No view component found on camera');
            return;
        }

        // current state
        this.currentZoom = 1.0;
        this.baseFov = this.defaultFov;

        // wire up the HTML buttons
        document.getElementById('zoom-x05')?.addEventListener('click', () => this.setZoom(0.5, 85));
        document.getElementById('zoom-x1') ?.addEventListener('click', () => this.setZoom(1.0, 60));
        document.getElementById('zoom-x2') ?.addEventListener('click', () => this.setZoom(2.0, 75));

        // set initial state
        this.setZoom(1.0, 60);
    }

    setZoom(factor, fov) {
        this.currentZoom = factor;

        // 1. Change FOV (this is the main visual zoom effect)
        this.view.fov = fov;

        // 2. Optional: also scale the tracked content (if you want true optical zoom feel)
        //    Find your tracking-target object(s) and scale them
        //    Example (adjust the object name to match your scene):
        const target = this.engine.scene.findByNameRecursive('Tracking Target 0')[0];
        if (target) {
            target.setScalingLocal([factor, factor, factor]);
            // or target.setScalingWorld([...]) depending on hierarchy
        }

        // 3. Update button active state
        document.querySelectorAll('.zoom-btn').forEach(btn => btn.classList.remove('active'));
        const activeId = factor === 0.5 ? 'zoom-x05' : factor === 2.0 ? 'zoom-x2' : 'zoom-x1';
        document.getElementById(activeId)?.classList.add('active');

        console.log(`Zoom set to x${factor} | FOV = ${fov}°`);
    }
}