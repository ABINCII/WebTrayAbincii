import {Component, Property} from '@wonderlandengine/api';

export class TrackingSmoother extends Component {
    static TypeName = 'tracking-smoother';

    static Properties = {
        /*
         * Higher value:
         * more responsive
         * less smoothing
         *
         * Lower value:
         * smoother
         * more tracking lag
         */
        smoothFactor: Property.float(12.0),
    };

    init() {
        this._position =
            new Float32Array(3);

        this._rotation =
            new Float32Array(4);

        this._hasPrevious =
            false;
    }

    update(dt) {
        /*
         * Don't smooth an inactive tracking
         * target.
         */
        if (!this.object.active) {
            this._hasPrevious = false;
            return;
        }

        const currentPosition =
            this.object.getPositionWorld();

        const currentRotation =
            this.object.getRotationWorld();

        /*
         * First frame after tracking begins.
         */
        if (!this._hasPrevious) {
            this._position.set(
                currentPosition
            );

            this._rotation.set(
                currentRotation
            );

            this._hasPrevious = true;

            return;
        }

        /*
         * Frame-rate-independent smoothing.
         */
        const t =
            1.0 -
            Math.exp(
                -this.smoothFactor * dt
            );

        /*
         * Position.
         */
        this._position[0] +=
            (
                currentPosition[0] -
                this._position[0]
            ) * t;

        this._position[1] +=
            (
                currentPosition[1] -
                this._position[1]
            ) * t;

        this._position[2] +=
            (
                currentPosition[2] -
                this._position[2]
            ) * t;

        /*
         * Rotation.
         *
         * This is the same simple nlerp
         * approach used in your original.
         */
        for (let i = 0; i < 4; i++) {
            this._rotation[i] +=
                (
                    currentRotation[i] -
                    this._rotation[i]
                ) * t;
        }

        /*
         * Normalize quaternion.
         */
        const length =
            Math.hypot(
                this._rotation[0],
                this._rotation[1],
                this._rotation[2],
                this._rotation[3]
            );

        if (length > 0.0001) {
            this._rotation[0] /= length;
            this._rotation[1] /= length;
            this._rotation[2] /= length;
            this._rotation[3] /= length;
        }

        /*
         * Apply smoothed transform.
         */
        this.object.setPositionWorld(
            this._position
        );

        this.object.setRotationWorld(
            this._rotation
        );
    }
}