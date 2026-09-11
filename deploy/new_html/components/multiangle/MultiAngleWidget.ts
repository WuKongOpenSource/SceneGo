




import { ThreeScene, SceneState } from './three_scene';
import { InteractionManager } from './interactions';
import { mapAnglesToPrompt, PromptOutput } from './prompt_mapper';

export interface MultiAngleWidgetConfig {
    container: HTMLElement;
    onChange?: (output: PromptOutput) => void;
    showDebug?: boolean;
}

export interface MultiAngleWidgetState {
    horizontal: number;
    vertical: number;
    zoom: number;
    hasImage: boolean;
}

export class MultiAngleWidget {
    private container: HTMLElement;
    private scene: ThreeScene | null = null;
    private interactions: InteractionManager | null = null;
    private onChange?: (output: PromptOutput) => void;
    private showDebug: boolean;


    private canvasWrapper: HTMLElement | null = null;
    private promptTextEl: HTMLElement | null = null;
    private horizontalValueEl: HTMLElement | null = null;
    private verticalValueEl: HTMLElement | null = null;
    private zoomValueEl: HTMLElement | null = null;
    private horizontalSnapEl: HTMLElement | null = null;
    private verticalSnapEl: HTMLElement | null = null;
    private zoomSnapEl: HTMLElement | null = null;
    private debugEl: HTMLElement | null = null;
    private uploadOverlay: HTMLElement | null = null;


    private _state: MultiAngleWidgetState = {
        horizontal: 0,
        vertical: 0,
        zoom: 5,
        hasImage: false,
    };

    private _output: PromptOutput;

    constructor(config: MultiAngleWidgetConfig) {
        this.container = config.container;
        this.onChange = config.onChange;
        this.showDebug = config.showDebug ?? false;


        this._output = mapAnglesToPrompt(0, 0, 5);


        this.createUI();


        this.initScene();
    }

    private createUI(): void {
        this.container.innerHTML = `
            <div class="mw-container">
                <div class="mw-header">
                    <div class="mw-header-title">ANGLE PROMPT</div>
                    <div class="mw-prompt-box">
                        <span class="mw-prompt-text" data-mw="prompt-text">${this._output.anglePromptSks}</span>
                        <button class="mw-copy-btn" data-mw="copy-btn">COPY</button>
                    </div>
                </div>

                <div class="mw-canvas-wrapper" data-mw="canvas-wrapper">
                    <div class="mw-upload-overlay" data-mw="upload-overlay">
                        <div class="mw-upload-icon">📷</div>
                        <div>点击或拖拽上传图片</div>
                    </div>
                    <div class="mw-drag-hint">拖拽粉色/青色手柄调整角度 · 滚轮缩放</div>
                </div>

                <div class="mw-footer">
                    <div class="mw-stat">
                        <div class="mw-stat-label">HORIZONTAL</div>
                        <div class="mw-stat-value" data-mw="horizontal-value">0°</div>
                        <div class="mw-stat-snap" data-mw="horizontal-snap">front view</div>
                    </div>
                    <div class="mw-stat">
                        <div class="mw-stat-label">VERTICAL</div>
                        <div class="mw-stat-value" data-mw="vertical-value">0°</div>
                        <div class="mw-stat-snap" data-mw="vertical-snap">eye-level shot</div>
                    </div>
                    <div class="mw-stat">
                        <div class="mw-stat-label">ZOOM</div>
                        <div class="mw-stat-value" data-mw="zoom-value">5.0</div>
                        <div class="mw-stat-snap" data-mw="zoom-snap">medium shot</div>
                    </div>
                </div>

                ${this.showDebug ? '<div class="mw-debug" data-mw="debug"></div>' : ''}
            </div>
        `;


        this.canvasWrapper = this.container.querySelector('[data-mw="canvas-wrapper"]');
        this.promptTextEl = this.container.querySelector('[data-mw="prompt-text"]');
        this.horizontalValueEl = this.container.querySelector('[data-mw="horizontal-value"]');
        this.verticalValueEl = this.container.querySelector('[data-mw="vertical-value"]');
        this.zoomValueEl = this.container.querySelector('[data-mw="zoom-value"]');
        this.horizontalSnapEl = this.container.querySelector('[data-mw="horizontal-snap"]');
        this.verticalSnapEl = this.container.querySelector('[data-mw="vertical-snap"]');
        this.zoomSnapEl = this.container.querySelector('[data-mw="zoom-snap"]');
        this.debugEl = this.container.querySelector('[data-mw="debug"]');
        this.uploadOverlay = this.container.querySelector('[data-mw="upload-overlay"]');


        const copyBtn = this.container.querySelector('[data-mw="copy-btn"]');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => this.copyPrompt());
        }

        if (this.uploadOverlay) {
            this.uploadOverlay.addEventListener('click', () => this.triggerFileUpload());
            this.uploadOverlay.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.uploadOverlay!.style.borderColor = '#00ffff';
            });
            this.uploadOverlay.addEventListener('dragleave', () => {
                this.uploadOverlay!.style.borderColor = '';
            });
            this.uploadOverlay.addEventListener('drop', (e) => this.handleDrop(e as DragEvent));
        }
    }

    private initScene(): void {
        if (!this.canvasWrapper) return;

        this.scene = new ThreeScene({
            container: this.canvasWrapper,
        });

        const canvas = this.scene.getRenderer().domElement;

        this.interactions = new InteractionManager({
            scene: this.scene,
            canvas: canvas,
            onStateChange: (state: SceneState) => {
                this._state.horizontal = state.azimuth;
                this._state.vertical = state.elevation;
                this._state.zoom = state.distance;
                this.updateOutput();
            },
        });


        this.updateOutput();
    }

    private updateOutput(): void {
        this._output = mapAnglesToPrompt(
            this._state.horizontal,
            this._state.vertical,
            this._state.zoom
        );

        this.updateUI();

        if (this.onChange) {
            this.onChange(this._output);
        }
    }

    private updateUI(): void {
        if (this.promptTextEl) {
            this.promptTextEl.textContent = this._output.anglePromptSks;
        }

        if (this.horizontalValueEl) {
            this.horizontalValueEl.textContent = `${Math.round(this._output.raw.horizontal)}°`;
        }

        if (this.verticalValueEl) {
            this.verticalValueEl.textContent = `${Math.round(this._output.raw.vertical)}°`;
        }

        if (this.zoomValueEl) {
            this.zoomValueEl.textContent = this._output.raw.zoom.toFixed(1);
        }

        if (this.horizontalSnapEl) {
            this.horizontalSnapEl.textContent = this._output.snapped.azimuthText;
        }

        if (this.verticalSnapEl) {
            this.verticalSnapEl.textContent = this._output.snapped.elevationText;
        }

        if (this.zoomSnapEl) {
            this.zoomSnapEl.textContent = this._output.snapped.distanceText;
        }

        if (this.debugEl) {
            this.debugEl.textContent = this._output.angleDebug;
        }
    }

    private copyPrompt(): void {
        navigator.clipboard.writeText(this._output.anglePromptSks).then(() => {
            const btn = this.container.querySelector('[data-mw="copy-btn"]') as HTMLButtonElement;
            if (btn) {
                const original = btn.textContent;
                btn.textContent = 'COPIED!';
                setTimeout(() => {
                    btn.textContent = original;
                }, 1500);
            }
        });
    }

    private triggerFileUpload(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                this.loadImageFile(file);
            }
        };
        input.click();
    }

    private handleDrop(e: DragEvent): void {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) {
            this.loadImageFile(file);
        }
    }

    private loadImageFile(file: File): void {
        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            this.setImage(dataUrl);
        };
        reader.readAsDataURL(file);
    }






    async setImage(imageUrl: string): Promise<void> {
        if (!this.scene) return;

        await this.scene.setImage(imageUrl);
        this._state.hasImage = true;

        if (this.uploadOverlay) {
            this.uploadOverlay.style.display = 'none';
        }
    }




    get state(): MultiAngleWidgetState {
        return { ...this._state };
    }




    get output(): PromptOutput {
        return this._output;
    }




    setAngles(horizontal: number, vertical: number, zoom: number): void {
        if (this.scene) {
            this.scene.setState({
                azimuth: horizontal,
                elevation: vertical,
                distance: zoom,
            });
        }

        this._state.horizontal = horizontal;
        this._state.vertical = vertical;
        this._state.zoom = zoom;
        this.updateOutput();
    }




    reset(): void {
        this.setAngles(0, 0, 5);
    }




    dispose(): void {
        if (this.interactions) {
            this.interactions.dispose();
            this.interactions = null;
        }

        if (this.scene) {
            this.scene.dispose();
            this.scene = null;
        }

        this.container.innerHTML = '';
    }
}


export type { PromptOutput } from './prompt_mapper';
