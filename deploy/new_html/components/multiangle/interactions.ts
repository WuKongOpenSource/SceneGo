




import * as THREE from 'three';
import { ThreeScene, SceneState } from './three_scene';

export type DragTarget = 'azimuth' | 'elevation' | null;

export interface InteractionConfig {
    scene: ThreeScene;
    canvas: HTMLCanvasElement;
    onDragStart?: (target: DragTarget) => void;
    onDragEnd?: () => void;
    onStateChange?: (state: SceneState) => void;
}

export class InteractionManager {
    private scene: ThreeScene;
    private canvas: HTMLCanvasElement;
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;

    private isDragging: boolean = false;
    private dragTarget: DragTarget = null;
    private lastMousePos: { x: number; y: number } = { x: 0, y: 0 };


    private onDragStart?: (target: DragTarget) => void;
    private onDragEnd?: () => void;
    private onStateChange?: (state: SceneState) => void;

    constructor(config: InteractionConfig) {
        this.scene = config.scene;
        this.canvas = config.canvas;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        this.onDragStart = config.onDragStart;
        this.onDragEnd = config.onDragEnd;
        this.onStateChange = config.onStateChange;

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        this.canvas.addEventListener('pointerdown', this.handlePointerDown);
        this.canvas.addEventListener('pointermove', this.handlePointerMove);
        this.canvas.addEventListener('pointerup', this.handlePointerUp);
        this.canvas.addEventListener('pointerleave', this.handlePointerUp);
        this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });


        this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd);
    }

    private updateMouse(event: PointerEvent | Touch): void {
        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    private checkIntersection(): DragTarget {
        this.raycaster.setFromCamera(this.mouse, this.scene.getCamera());

        const azimuthHandle = this.scene.getAzimuthHandle();
        const elevationHandle = this.scene.getElevationHandle();

        const objects: THREE.Object3D[] = [];
        if (azimuthHandle) objects.push(azimuthHandle);
        if (elevationHandle) objects.push(elevationHandle);

        const intersects = this.raycaster.intersectObjects(objects);

        if (intersects.length > 0) {
            if (intersects[0].object === azimuthHandle) {
                return 'azimuth';
            } else if (intersects[0].object === elevationHandle) {
                return 'elevation';
            }
        }

        return null;
    }

    private handlePointerDown = (event: PointerEvent): void => {
        event.preventDefault();
        this.updateMouse(event);

        const target = this.checkIntersection();

        if (target) {
            this.isDragging = true;
            this.dragTarget = target;
            this.lastMousePos = { x: event.clientX, y: event.clientY };
            this.canvas.setPointerCapture(event.pointerId);

            if (this.onDragStart) {
                this.onDragStart(target);
            }
        }
    };

    private handlePointerMove = (event: PointerEvent): void => {
        if (!this.isDragging || !this.dragTarget) {

            this.updateMouse(event);
            const target = this.checkIntersection();
            this.canvas.style.cursor = target ? 'grab' : 'default';
            return;
        }

        this.canvas.style.cursor = 'grabbing';

        const deltaX = event.clientX - this.lastMousePos.x;
        const deltaY = event.clientY - this.lastMousePos.y;

        const state = this.scene.state;

        if (this.dragTarget === 'azimuth') {

            const newAzimuth = state.azimuth + deltaX * 0.5;
            this.scene.setState({ azimuth: newAzimuth });
        } else if (this.dragTarget === 'elevation') {

            const newElevation = state.elevation - deltaY * 0.5;
            this.scene.setState({ elevation: newElevation });
        }

        this.lastMousePos = { x: event.clientX, y: event.clientY };

        if (this.onStateChange) {
            this.onStateChange(this.scene.state);
        }
    };

    private handlePointerUp = (event: PointerEvent): void => {
        if (this.isDragging) {
            this.canvas.releasePointerCapture(event.pointerId);
            this.isDragging = false;
            this.dragTarget = null;
            this.canvas.style.cursor = 'default';

            if (this.onDragEnd) {
                this.onDragEnd();
            }
        }
    };

    private handleWheel = (event: WheelEvent): void => {
        event.preventDefault();

        const state = this.scene.state;
        const delta = event.deltaY > 0 ? 0.5 : -0.5;
        const newDistance = Math.max(0, Math.min(10, state.distance + delta));

        this.scene.setState({ distance: newDistance });

        if (this.onStateChange) {
            this.onStateChange(this.scene.state);
        }
    };


    private lastTouchDistance: number = 0;

    private handleTouchStart = (event: TouchEvent): void => {
        event.preventDefault();

        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.updateMouse(touch);

            const target = this.checkIntersection();
            if (target) {
                this.isDragging = true;
                this.dragTarget = target;
                this.lastMousePos = { x: touch.clientX, y: touch.clientY };

                if (this.onDragStart) {
                    this.onDragStart(target);
                }
            }
        } else if (event.touches.length === 2) {

            this.lastTouchDistance = this.getTouchDistance(event.touches);
        }
    };

    private handleTouchMove = (event: TouchEvent): void => {
        event.preventDefault();

        if (event.touches.length === 1 && this.isDragging && this.dragTarget) {
            const touch = event.touches[0];
            const deltaX = touch.clientX - this.lastMousePos.x;
            const deltaY = touch.clientY - this.lastMousePos.y;

            const state = this.scene.state;

            if (this.dragTarget === 'azimuth') {
                const newAzimuth = state.azimuth + deltaX * 0.5;
                this.scene.setState({ azimuth: newAzimuth });
            } else if (this.dragTarget === 'elevation') {
                const newElevation = state.elevation - deltaY * 0.5;
                this.scene.setState({ elevation: newElevation });
            }

            this.lastMousePos = { x: touch.clientX, y: touch.clientY };

            if (this.onStateChange) {
                this.onStateChange(this.scene.state);
            }
        } else if (event.touches.length === 2) {

            const currentDistance = this.getTouchDistance(event.touches);
            const delta = (this.lastTouchDistance - currentDistance) * 0.02;

            const state = this.scene.state;
            const newDistance = Math.max(0, Math.min(10, state.distance + delta));
            this.scene.setState({ distance: newDistance });

            this.lastTouchDistance = currentDistance;

            if (this.onStateChange) {
                this.onStateChange(this.scene.state);
            }
        }
    };

    private handleTouchEnd = (): void => {
        this.isDragging = false;
        this.dragTarget = null;

        if (this.onDragEnd) {
            this.onDragEnd();
        }
    };

    private getTouchDistance(touches: TouchList): number {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    dispose(): void {
        this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
        this.canvas.removeEventListener('pointermove', this.handlePointerMove);
        this.canvas.removeEventListener('pointerup', this.handlePointerUp);
        this.canvas.removeEventListener('pointerleave', this.handlePointerUp);
        this.canvas.removeEventListener('wheel', this.handleWheel);
        this.canvas.removeEventListener('touchstart', this.handleTouchStart);
        this.canvas.removeEventListener('touchmove', this.handleTouchMove);
        this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    }
}
