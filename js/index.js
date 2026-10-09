/**
 * Wonderland Engine entry point
 */

import {
    ImageTracking,
    ImageTrackingTarget
} from '@wonderlandengine/mind-ar-tracking';

import {ARMenuManager} from './ARMenuManager.js';

import {TrackingSmoother} from './TrackingSmoother.js';

export default function(engine) {

    /*
     * MindAR
     */
    engine.registerComponent(
        ImageTracking
    );

    engine.registerComponent(
        ImageTrackingTarget
    );

    /*
     * AR restaurant menu.
     */
    engine.registerComponent(
        ARMenuManager
    );

    /*
     * Tracking smoothing.
     */
    engine.registerComponent(
        TrackingSmoother
    );
}