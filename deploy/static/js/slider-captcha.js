/* Same-origin puzzle dialog. Only a server-issued proof can complete verification. */
(() => {
    class SliderCaptcha {
        constructor() {
            this.pending = null;
            this.generation = 0;
        }

        verify(action) {
            if (this.pending) return this.pending.promise;
            const previousFocus = document.activeElement;
            const overlay = document.createElement('div');
            overlay.className = 'slider-captcha-overlay';
            overlay.innerHTML = `<section class="slider-captcha-dialog" role="dialog" aria-modal="true" aria-labelledby="sliderCaptchaTitle">
                <header><h3 id="sliderCaptchaTitle">请完成安全验证</h3><button type="button" data-close aria-label="关闭安全验证">×</button></header>
                <p class="slider-captcha-instruction">向右拖动滑块，让拼图对齐缺口</p>
                <div class="slider-captcha-picture" hidden><img data-background alt="带拼图缺口的验证图片" draggable="false"><img data-piece class="slider-captcha-piece" alt="可移动拼图" draggable="false"></div>
                <input data-slider type="range" min="0" value="0" step="1" disabled aria-label="拖动拼图对齐缺口" aria-describedby="sliderCaptchaStatus">
                <p id="sliderCaptchaStatus" class="slider-captcha-status" role="status" aria-live="polite">正在加载拼图…</p>
                <footer><button type="button" data-refresh>换一张</button><button type="button" data-confirm disabled>确认对齐</button></footer>
                <small>本站安全验证 · 支持触屏拖动，也可用方向键调整后按回车</small>
            </section>`;
            document.body.appendChild(overlay);
            this.overlay = overlay;
            this.range = overlay.querySelector('[data-slider]');
            this.status = overlay.querySelector('[role="status"]');
            const promise = new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
            Object.assign(this.pending, { promise, action, previousFocus });
            overlay.querySelector('[data-close]').onclick = () => this.cancel();
            overlay.querySelector('[data-refresh]').onclick = () => void this.load();
            overlay.querySelector('[data-confirm]').onclick = () => void this.check();
            const renderPosition = () => {
                if (this.challenge) overlay.querySelector('[data-piece]').style.left = `${Number(this.range.value) / this.challenge.width * 100}%`;
            };
            this.range.oninput = renderPosition;
            const cancelDrag = () => {
                const drag = this.drag;
                this.drag = null;
                if (drag?.kind === 'pointer' && this.range.hasPointerCapture?.(drag.id)) {
                    this.range.releasePointerCapture(drag.id);
                }
            };
            const beginDrag = (event, kind, id, clientX) => {
                if (this.range.disabled || !this.challenge || this.drag) return;
                // Own the position update instead of relying on WebKit's native
                // range-thumb drag. Its default handling varies across Safari.
                event.preventDefault();
                this.range.focus();
                const rect = this.range.getBoundingClientRect();
                const style = getComputedStyle(this.range);
                const thumb = parseFloat(style.getPropertyValue('--slider-thumb-size')) || 42;
                const border = parseFloat(style.borderLeftWidth) || 0;
                const travel = Math.max(1, rect.width - border * 2 - thumb);
                const value = Number(this.range.value);
                const center = rect.left + border + thumb / 2 + value / Number(this.range.max) * travel;
                const startValue = Math.abs(clientX - center) <= thumb / 2 ? value
                    : Math.max(0, Math.min(Number(this.range.max), (clientX - rect.left - border - thumb / 2) / travel * Number(this.range.max)));
                this.drag = { kind, id, startX: clientX, startValue, initialValue: value, travel, moved: false };
                this.range.value = String(Math.round(startValue));
                renderPosition();
                if (kind === 'pointer') {
                    try { this.range.setPointerCapture(id); } catch { /* Window listeners still handle release. */ }
                }
            };
            const moveDrag = (event, kind, id, clientX) => {
                const drag = this.drag;
                if (!drag || drag.kind !== kind || drag.id !== id) return;
                if (event.cancelable) event.preventDefault();
                if (Math.abs(clientX - drag.startX) >= 3) drag.moved = true;
                const value = drag.startValue + (clientX - drag.startX) / drag.travel * Number(this.range.max);
                this.range.value = String(Math.round(Math.max(0, Math.min(Number(this.range.max), value))));
                renderPosition();
            };
            const finishDrag = (event, kind, id, clientX) => {
                const drag = this.drag;
                if (!drag || drag.kind !== kind || drag.id !== id) return;
                moveDrag(event, kind, id, clientX);
                const shouldCheck = drag.moved && Number(this.range.value) !== drag.initialValue;
                cancelDrag();
                if (shouldCheck) void this.check();
            };
            const pointerDown = event => {
                if (event.button === 0 && event.isPrimary !== false) beginDrag(event, 'pointer', event.pointerId, event.clientX);
            };
            const pointerMove = event => moveDrag(event, 'pointer', event.pointerId, event.clientX);
            const pointerUp = event => finishDrag(event, 'pointer', event.pointerId, event.clientX);
            // Mouse/touch fallbacks also work when a browser exposes PointerEvent
            // but does not deliver it to a native range input.
            const mouseDown = event => { if (event.button === 0) beginDrag(event, 'mouse', 0, event.clientX); };
            const mouseMove = event => moveDrag(event, 'mouse', 0, event.clientX);
            const mouseUp = event => finishDrag(event, 'mouse', 0, event.clientX);
            const touchDown = event => {
                if (event.touches.length === 1) beginDrag(event, 'touch', event.touches[0].identifier, event.touches[0].clientX);
            };
            const touchMove = event => {
                for (const touch of event.changedTouches) moveDrag(event, 'touch', touch.identifier, touch.clientX);
            };
            const touchUp = event => {
                for (const touch of event.changedTouches) finishDrag(event, 'touch', touch.identifier, touch.clientX);
            };
            this.range.addEventListener('pointerdown', pointerDown);
            this.range.addEventListener('mousedown', mouseDown);
            this.range.addEventListener('touchstart', touchDown, { passive: false });
            window.addEventListener('pointermove', pointerMove);
            window.addEventListener('pointerup', pointerUp);
            window.addEventListener('pointercancel', cancelDrag);
            window.addEventListener('mousemove', mouseMove);
            window.addEventListener('mouseup', mouseUp);
            window.addEventListener('touchmove', touchMove, { passive: false });
            window.addEventListener('touchend', touchUp);
            window.addEventListener('touchcancel', cancelDrag);
            window.addEventListener('blur', cancelDrag);
            this.cancelDrag = cancelDrag;
            this.cleanupDrag = () => {
                cancelDrag();
                window.removeEventListener('pointermove', pointerMove);
                window.removeEventListener('pointerup', pointerUp);
                window.removeEventListener('pointercancel', cancelDrag);
                window.removeEventListener('mousemove', mouseMove);
                window.removeEventListener('mouseup', mouseUp);
                window.removeEventListener('touchmove', touchMove);
                window.removeEventListener('touchend', touchUp);
                window.removeEventListener('touchcancel', cancelDrag);
                window.removeEventListener('blur', cancelDrag);
            };
            overlay.onkeydown = event => {
                if (event.key === 'Escape') { event.preventDefault(); this.cancel(); }
                if (event.key === 'Enter' && event.target === this.range) { event.preventDefault(); void this.check(); }
                if (event.key === 'Tab') {
                    const controls = [...overlay.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
                    const first = controls[0], last = controls.at(-1);
                    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                }
            };
            overlay.querySelector('[data-close]').focus();
            void this.load();
            return promise;
        }

        async request(url, body) {
            const controller = new AbortController();
            this.controller = controller;
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body), signal: controller.signal });
                const result = await response.json();
                if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '安全验证失败，请重试');
                return result;
            } catch (error) {
                if (error.name === 'AbortError') throw new Error('验证请求超时，请点击“换一张”重试');
                throw error;
            } finally {
                clearTimeout(timer);
                if (this.controller === controller) this.controller = null;
            }
        }

        async load() {
            if (!this.pending || this.loading || this.checking) return;
            this.loading = true;
            this.cancelDrag?.();
            this.challenge = null;
            this.range.disabled = true;
            this.overlay.querySelector('[data-confirm]').disabled = true;
            this.overlay.querySelector('[data-refresh]').disabled = true;
            this.overlay.querySelector('.slider-captcha-picture').hidden = true;
            this.status.textContent = '正在加载拼图…';
            const generation = ++this.generation;
            try {
                const result = await this.request('/api/auth/captcha/challenge', { action: this.pending.action });
                if (!this.pending || generation !== this.generation) return;
                if (!/^data:image\/(jpeg|png);base64,/.test(result.background) || !/^data:image\/png;base64,/.test(result.piece) || result.width !== 320 || result.height !== 160 || result.piece_size !== 56) throw new Error('验证图片加载失败，请换一张');
                this.challenge = result;
                this.expiresAt = Date.now() + result.expires_in * 1000;
                this.overlay.querySelector('[data-background]').src = result.background;
                const piece = this.overlay.querySelector('[data-piece]');
                piece.src = result.piece;
                piece.style.width = `${result.piece_size / result.width * 100}%`;
                piece.style.top = `${result.y / result.height * 100}%`;
                piece.style.left = '0%';
                this.overlay.querySelector('.slider-captcha-picture').hidden = false;
                this.range.max = String(result.width - result.piece_size);
                this.range.value = '0';
                this.range.disabled = false;
                this.overlay.querySelector('[data-confirm]').disabled = false;
                this.status.textContent = '拖动滑块对齐缺口，松开后自动验证';
                this.range.focus();
            } catch (error) {
                if (this.pending && generation === this.generation) this.status.textContent = error.message || '拼图加载失败，请换一张重试';
            } finally {
                if (generation === this.generation) {
                    this.loading = false;
                    if (this.overlay) this.overlay.querySelector('[data-refresh]').disabled = false;
                }
            }
        }

        async check() {
            if (!this.pending || !this.challenge || this.loading || this.checking) return;
            if (Date.now() >= this.expiresAt) {
                this.challenge = null;
                this.range.disabled = true;
                this.overlay.querySelector('[data-confirm]').disabled = true;
                this.status.textContent = '拼图已过期，请点击“换一张”重试';
                return;
            }
            this.checking = true;
            this.range.disabled = true;
            this.overlay.querySelector('[data-confirm]').disabled = true;
            this.overlay.querySelector('[data-refresh]').disabled = true;
            this.status.textContent = '正在核对…';
            const generation = this.generation;
            try {
                const result = await this.request('/api/auth/captcha/check', { action: this.pending.action, challenge_id: this.challenge.challenge_id, x: Number(this.range.value) });
                if (!this.pending || generation !== this.generation) return;
                if (!/^slider\.[A-Za-z0-9_-]{43}$/.test(result.captcha_verification)) throw new Error('验证响应无效，请换一张重试');
                const resolve = this.pending.resolve;
                this.close();
                resolve(result);
            } catch (error) {
                if (this.pending && generation === this.generation) {
                    this.challenge = null;
                    this.status.textContent = `${error.message || '验证失败'}；本张已失效，请点击“换一张”后重新拖动。`;
                    this.overlay.querySelector('[data-refresh]').textContent = '换一张重试';
                }
            } finally {
                if (this.pending && generation === this.generation) {
                    this.checking = false;
                    this.overlay.querySelector('[data-refresh]').disabled = false;
                }
            }
        }

        close() {
            this.generation++;
            this.cleanupDrag?.();
            this.cleanupDrag = null;
            this.controller?.abort();
            this.controller = null;
            const previousFocus = this.pending?.previousFocus;
            this.pending = null;
            this.overlay?.remove();
            this.overlay = null;
            this.challenge = null;
            this.loading = false;
            this.checking = false;
            this.drag = null;
            if (previousFocus?.isConnected) previousFocus.focus();
        }

        cancel() {
            const reject = this.pending?.reject;
            this.close();
            if (reject) { const error = new Error('已取消安全验证'); error.name = 'CaptchaCancelled'; reject(error); }
        }
    }
    window.OstorySliderCaptcha = SliderCaptcha;
})();
