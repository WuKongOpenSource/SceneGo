




import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';


const AZIMUTH_SNAPS = [
    { angle: 0, text: 'front view', short: 'front' },
    { angle: 45, text: 'front-right quarter view', short: 'front-right' },
    { angle: 90, text: 'right side view', short: 'right side' },
    { angle: 135, text: 'back-right quarter view', short: 'back-right' },
    { angle: 180, text: 'back view', short: 'back' },
    { angle: 225, text: 'back-left quarter view', short: 'back-left' },
    { angle: 270, text: 'left side view', short: 'left side' },
    { angle: 315, text: 'front-left quarter view', short: 'front-left' },
];


const ELEVATION_SNAPS = [
    { angle: -30, text: 'low-angle shot', short: 'low' },
    { angle: 0, text: 'eye-level shot', short: 'eye level' },
    { angle: 45, text: 'elevated shot', short: 'elevated' },
    { angle: 90, text: 'high-angle shot', short: 'high' },
];


const DISTANCE_SNAPS = [
    { min: 0, max: 2, text: 'wide shot', short: 'wide' },
    { min: 2, max: 6, text: 'medium shot', short: 'medium' },
    { min: 6, max: 10.01, text: 'close-up', short: 'close-up' },
];

interface MultiAngle3DControllerProps {
    imageUrl: string;
    onChange?: (prompt: string, raw: { horizontal: number; vertical: number; zoom: number }) => void;
    initialValues?: { horizontal: number; vertical: number; zoom: number };
    useQwenFormat?: boolean;
}

const MultiAngle3DController: React.FC<MultiAngle3DControllerProps> = ({
    imageUrl,
    onChange,
    initialValues = { horizontal: 0, vertical: 0, zoom: 5 },
    useQwenFormat = true
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const animationIdRef = useRef<number>(0);


    const azimuthHandleRef = useRef<THREE.Mesh | null>(null);
    const azimuthGlowRef = useRef<THREE.Mesh | null>(null);
    const elevationHandleRef = useRef<THREE.Mesh | null>(null);
    const elevationGlowRef = useRef<THREE.Mesh | null>(null);
    const distanceHandleRef = useRef<THREE.Mesh | null>(null);
    const distanceGlowRef = useRef<THREE.Mesh | null>(null);
    const cameraIndicatorRef = useRef<THREE.Mesh | null>(null);
    const camGlowRef = useRef<THREE.Mesh | null>(null);
    const distanceTubeRef = useRef<THREE.Mesh | null>(null);
    const imagePlaneRef = useRef<THREE.Mesh | null>(null);
    const imageFrameRef = useRef<THREE.LineSegments | null>(null);

    const [values, setValues] = useState(initialValues);
    const [dragTarget, setDragTarget] = useState<string | null>(null);
    const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);
    const valuesRef = useRef(initialValues);


    const updateVisualsRef = useRef<(() => void) | null>(null);


    const CENTER = new THREE.Vector3(0, 2.0, 0);
    const AZIMUTH_RADIUS = 5.0;
    const ELEVATION_RADIUS = 4.0;
    const ELEV_ARC_X = -2.2;


    const snapAzimuth = useCallback((angle: number) => {
        let normalized = ((angle % 360) + 360) % 360;
        let closest = AZIMUTH_SNAPS[0];
        let minDiff = 360;
        for (const snap of AZIMUTH_SNAPS) {
            let diff = Math.abs(normalized - snap.angle);
            if (diff > 180) diff = 360 - diff;
            if (diff < minDiff) {
                minDiff = diff;
                closest = snap;
            }
        }
        return closest;
    }, []);

    const snapElevation = useCallback((angle: number) => {
        const clamped = Math.max(-30, Math.min(90, angle));
        let closest = ELEVATION_SNAPS[0];
        let minDiff = 180;
        for (const snap of ELEVATION_SNAPS) {
            const diff = Math.abs(clamped - snap.angle);
            if (diff < minDiff) {
                minDiff = diff;
                closest = snap;
            }
        }
        return closest;
    }, []);

    const snapDistance = useCallback((zoom: number) => {
        const clamped = Math.max(0, Math.min(10, zoom));
        for (const snap of DISTANCE_SNAPS) {
            if (clamped >= snap.min && clamped < snap.max) {
                return snap;
            }
        }
        return DISTANCE_SNAPS[2];
    }, []);


    const generatePrompt = useCallback((h: number, v: number, z: number) => {
        const azSnap = snapAzimuth(h);
        const elSnap = snapElevation(v);
        const distSnap = snapDistance(z);

        if (useQwenFormat) {

            return `<sks> ${azSnap.text} ${elSnap.text} ${distSnap.text}`;
        } else {

            return `${azSnap.text}, ${elSnap.text}, ${distSnap.text} (horizontal: ${Math.round(h)}, vertical: ${Math.round(v)}, zoom: ${z.toFixed(1)})`;
        }
    }, [snapAzimuth, snapElevation, snapDistance, useQwenFormat]);


    useEffect(() => {

        const hasChanged =
            Math.abs(valuesRef.current.horizontal - initialValues.horizontal) > 0.1 ||
            Math.abs(valuesRef.current.vertical - initialValues.vertical) > 0.1 ||
            Math.abs(valuesRef.current.zoom - initialValues.zoom) > 0.1;

        if (hasChanged) {
            valuesRef.current = { ...initialValues };
            setValues({ ...initialValues });


            if (updateVisualsRef.current) {
                updateVisualsRef.current();
            }


            const prompt = generatePrompt(initialValues.horizontal, initialValues.vertical, initialValues.zoom);
            if (onChange) {
                onChange(prompt, initialValues);
            }
        }
    }, [initialValues.horizontal, initialValues.vertical, initialValues.zoom, generatePrompt, onChange]);


    const updateValues = useCallback((newValues: Partial<typeof values>) => {
        const updated = {
            horizontal: ((newValues.horizontal ?? valuesRef.current.horizontal) % 360 + 360) % 360,
            vertical: Math.max(-30, Math.min(90, newValues.vertical ?? valuesRef.current.vertical)),
            zoom: Math.max(0, Math.min(10, newValues.zoom ?? valuesRef.current.zoom))
        };
        valuesRef.current = updated;
        setValues(updated);

        const prompt = generatePrompt(updated.horizontal, updated.vertical, updated.zoom);
        if (onChange) {
            onChange(prompt, updated);
        }
    }, [generatePrompt, onChange]);


    const updateVisuals = useCallback(() => {
        const liveAzimuth = valuesRef.current.horizontal;
        const liveElevation = valuesRef.current.vertical;
        const liveDistance = valuesRef.current.zoom;

        const azRad = (liveAzimuth * Math.PI) / 180;
        const elRad = (liveElevation * Math.PI) / 180;

        const visualDist = 5.0 - (liveDistance / 10) * 4.0;


        const camX = visualDist * Math.sin(azRad) * Math.cos(elRad);
        const camY = CENTER.y + visualDist * Math.sin(elRad);
        const camZ = visualDist * Math.cos(azRad) * Math.cos(elRad);

        if (cameraIndicatorRef.current) {
            cameraIndicatorRef.current.position.set(camX, camY, camZ);
            cameraIndicatorRef.current.lookAt(CENTER);
            cameraIndicatorRef.current.rotateX(Math.PI / 2);
        }
        if (camGlowRef.current) {
            camGlowRef.current.position.set(camX, camY, camZ);
        }


        const azX = AZIMUTH_RADIUS * Math.sin(azRad);
        const azZ = AZIMUTH_RADIUS * Math.cos(azRad);
        if (azimuthHandleRef.current) {
            azimuthHandleRef.current.position.set(azX, 0.16, azZ);
        }
        if (azimuthGlowRef.current) {
            azimuthGlowRef.current.position.set(azX, 0.16, azZ);
        }


        const elY = CENTER.y + ELEVATION_RADIUS * Math.sin(elRad);
        const elZ = ELEVATION_RADIUS * Math.cos(elRad);
        if (elevationHandleRef.current) {
            elevationHandleRef.current.position.set(ELEV_ARC_X, elY, elZ);
        }
        if (elevationGlowRef.current) {
            elevationGlowRef.current.position.set(ELEV_ARC_X, elY, elZ);
        }


        const distT = 0.15 + ((10 - liveDistance) / 10) * 0.7;
        const distPos = new THREE.Vector3().lerpVectors(CENTER, new THREE.Vector3(camX, camY, camZ), distT);
        if (distanceHandleRef.current) {
            distanceHandleRef.current.position.copy(distPos);
        }
        if (distanceGlowRef.current) {
            distanceGlowRef.current.position.copy(distPos);
        }


        if (distanceTubeRef.current && sceneRef.current) {
            sceneRef.current.remove(distanceTubeRef.current);
            distanceTubeRef.current.geometry.dispose();
            (distanceTubeRef.current.material as THREE.Material).dispose();
        }
        if (sceneRef.current) {
            const path = new THREE.LineCurve3(CENTER.clone(), new THREE.Vector3(camX, camY, camZ));
            const tubeGeo = new THREE.TubeGeometry(path, 1, 0.025, 8, false);
            const tubeMat = new THREE.MeshBasicMaterial({
                color: 0xFFB800,
                transparent: true,
                opacity: 0.8
            });
            const tube = new THREE.Mesh(tubeGeo, tubeMat);
            sceneRef.current.add(tube);
            distanceTubeRef.current = tube;
        }
    }, []);


    useEffect(() => {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth;
        const height = container.clientHeight;


        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0f);
        sceneRef.current = scene;


        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        camera.position.set(10, 8, 10);
        camera.lookAt(0, 1.5, 0);
        cameraRef.current = camera;


        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);
        rendererRef.current = renderer;


        const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambientLight);

        const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
        mainLight.position.set(5, 10, 5);
        scene.add(mainLight);

        const fillLight = new THREE.DirectionalLight(0xE93D82, 0.3);
        fillLight.position.set(-5, 5, -5);
        scene.add(fillLight);


        const gridHelper = new THREE.GridHelper(20, 40, 0x1a1a2e, 0x12121a);
        gridHelper.position.y = -0.01;
        scene.add(gridHelper);


        const cardThickness = 0.02;
        const cardGeo = new THREE.BoxGeometry(4.8, 3.3, cardThickness);


        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#1E1E26';
        ctx.fillRect(0, 0, size, size);
        ctx.strokeStyle = '#2B2B36';
        ctx.lineWidth = 1;
        const gridSize = 16;
        for (let i = 0; i <= size; i += gridSize) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, size);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(size, i);
            ctx.stroke();
        }
        const gridTexture = new THREE.CanvasTexture(canvas);
        gridTexture.wrapS = THREE.RepeatWrapping;
        gridTexture.wrapT = THREE.RepeatWrapping;
        gridTexture.repeat.set(4, 4);

        const frontMat = new THREE.MeshBasicMaterial({ color: 0x3a3a4a });
        const backMat = new THREE.MeshBasicMaterial({ map: gridTexture });
        const edgeMat = new THREE.MeshBasicMaterial({ color: 0x1a1a2a });
        const cardMaterials = [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, backMat];
        const imagePlane = new THREE.Mesh(cardGeo, cardMaterials);
        imagePlane.position.copy(CENTER);
        scene.add(imagePlane);
        imagePlaneRef.current = imagePlane;


        const frameGeo = new THREE.EdgesGeometry(cardGeo);
        const frameMat = new THREE.LineBasicMaterial({ color: 0xE93D82 });
        const imageFrame = new THREE.LineSegments(frameGeo, frameMat);
        imageFrame.position.copy(CENTER);
        scene.add(imageFrame);
        imageFrameRef.current = imageFrame;


        const glowRingGeo = new THREE.RingGeometry(1.1, 1.18, 64);
        const glowRingMat = new THREE.MeshBasicMaterial({
            color: 0xE93D82,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        const glowRing = new THREE.Mesh(glowRingGeo, glowRingMat);
        glowRing.position.set(0, 0.01, 0);
        glowRing.rotation.x = -Math.PI / 2;
        scene.add(glowRing);


        const camGeo = new THREE.ConeGeometry(0.20, 0.5, 4);
        const camMat = new THREE.MeshStandardMaterial({
            color: 0xE93D82,
            emissive: 0xE93D82,
            emissiveIntensity: 0.5,
            metalness: 0.8,
            roughness: 0.2
        });
        const cameraIndicator = new THREE.Mesh(camGeo, camMat);
        scene.add(cameraIndicator);
        cameraIndicatorRef.current = cameraIndicator;

        const camGlowGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const camGlowMat = new THREE.MeshBasicMaterial({
            color: 0xff6ba8,
            transparent: true,
            opacity: 0.8
        });
        const camGlow = new THREE.Mesh(camGlowGeo, camGlowMat);
        scene.add(camGlow);
        camGlowRef.current = camGlow;


        const azRingGeo = new THREE.TorusGeometry(AZIMUTH_RADIUS, 0.06, 16, 100);
        const azRingMat = new THREE.MeshBasicMaterial({
            color: 0xE93D82,
            transparent: true,
            opacity: 0.7
        });
        const azimuthRing = new THREE.Mesh(azRingGeo, azRingMat);
        azimuthRing.rotation.x = Math.PI / 2;
        azimuthRing.position.y = 0.02;
        scene.add(azimuthRing);


        const azHandleGeo = new THREE.SphereGeometry(0.24, 32, 32);
        const azHandleMat = new THREE.MeshStandardMaterial({
            color: 0xE93D82,
            emissive: 0xE93D82,
            emissiveIntensity: 0.6,
            metalness: 0.3,
            roughness: 0.4
        });
        const azimuthHandle = new THREE.Mesh(azHandleGeo, azHandleMat);
        scene.add(azimuthHandle);
        azimuthHandleRef.current = azimuthHandle;

        const azGlowGeo = new THREE.SphereGeometry(0.32, 16, 16);
        const azGlowMat = new THREE.MeshBasicMaterial({
            color: 0xE93D82,
            transparent: true,
            opacity: 0.2
        });
        const azGlow = new THREE.Mesh(azGlowGeo, azGlowMat);
        scene.add(azGlow);
        azimuthGlowRef.current = azGlow;


        const arcPoints: THREE.Vector3[] = [];
        for (let i = 0; i <= 32; i++) {
            const angle = (-30 + (120 * i / 32)) * Math.PI / 180;
            arcPoints.push(new THREE.Vector3(
                ELEV_ARC_X,
                ELEVATION_RADIUS * Math.sin(angle) + CENTER.y,
                ELEVATION_RADIUS * Math.cos(angle)
            ));
        }
        const arcCurve = new THREE.CatmullRomCurve3(arcPoints);
        const elArcGeo = new THREE.TubeGeometry(arcCurve, 32, 0.04, 8, false);
        const elArcMat = new THREE.MeshBasicMaterial({
            color: 0x00FFD0,
            transparent: true,
            opacity: 0.8
        });
        const elevationArc = new THREE.Mesh(elArcGeo, elArcMat);
        scene.add(elevationArc);


        const elHandleGeo = new THREE.SphereGeometry(0.24, 32, 32);
        const elHandleMat = new THREE.MeshStandardMaterial({
            color: 0x00FFD0,
            emissive: 0x00FFD0,
            emissiveIntensity: 0.6,
            metalness: 0.3,
            roughness: 0.4
        });
        const elevationHandle = new THREE.Mesh(elHandleGeo, elHandleMat);
        scene.add(elevationHandle);
        elevationHandleRef.current = elevationHandle;

        const elGlowGeo = new THREE.SphereGeometry(0.32, 16, 16);
        const elGlowMat = new THREE.MeshBasicMaterial({
            color: 0x00FFD0,
            transparent: true,
            opacity: 0.2
        });
        const elGlow = new THREE.Mesh(elGlowGeo, elGlowMat);
        scene.add(elGlow);
        elevationGlowRef.current = elGlow;


        const distHandleGeo = new THREE.SphereGeometry(0.22, 32, 32);
        const distHandleMat = new THREE.MeshStandardMaterial({
            color: 0xFFB800,
            emissive: 0xFFB800,
            emissiveIntensity: 0.7,
            metalness: 0.5,
            roughness: 0.3
        });
        const distanceHandle = new THREE.Mesh(distHandleGeo, distHandleMat);
        scene.add(distanceHandle);
        distanceHandleRef.current = distanceHandle;

        const distGlowGeo = new THREE.SphereGeometry(0.32, 16, 16);
        const distGlowMat = new THREE.MeshBasicMaterial({
            color: 0xFFB800,
            transparent: true,
            opacity: 0.25
        });
        const distGlow = new THREE.Mesh(distGlowGeo, distGlowMat);
        scene.add(distGlow);
        distanceGlowRef.current = distGlow;


        if (imageUrl) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const tex = new THREE.Texture(img);
                tex.needsUpdate = true;
                frontMat.map = tex;
                frontMat.color.set(0xffffff);
                frontMat.needsUpdate = true;

                const ar = img.width / img.height;
                const maxSize = 1.5;
                let scaleX, scaleY;
                if (ar > 1) {
                    scaleX = maxSize;
                    scaleY = maxSize / ar;
                } else {
                    scaleY = maxSize;
                    scaleX = maxSize * ar;
                }
                imagePlane.scale.set(scaleX, scaleY, 1);
                imageFrame.scale.set(scaleX, scaleY, 1);
            };
            img.src = imageUrl;
        }


        updateVisuals();


        updateVisualsRef.current = updateVisuals;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const getMousePos = (event: MouseEvent) => {
            const rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        };

        const setHandleScale = (handle: THREE.Mesh | null, glow: THREE.Mesh | null, scale: number) => {
            if (handle) handle.scale.setScalar(scale);
            if (glow) glow.scale.setScalar(scale);
        };

        let isDragging = false;
        let currentDragTarget: string | null = null;

        let dragStartMouseAngle = 0;
        let dragStartValue = 0;
        let dragStartMouseY = 0;

        const onPointerDown = (event: MouseEvent) => {
            getMousePos(event);
            raycaster.setFromCamera(mouse, camera);

            const handles = [
                { mesh: azimuthHandle, glow: azGlow, name: 'azimuth' },
                { mesh: elevationHandle, glow: elGlow, name: 'elevation' },
                { mesh: distanceHandle, glow: distGlow, name: 'distance' }
            ];

            for (const h of handles) {
                if (raycaster.intersectObject(h.mesh).length > 0) {
                    isDragging = true;
                    currentDragTarget = h.name;
                    setDragTarget(h.name);
                    setHandleScale(h.mesh, h.glow, 1.3);
                    renderer.domElement.style.cursor = 'grabbing';


                    if (h.name === 'azimuth') {

                        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                        const intersect = new THREE.Vector3();
                        if (raycaster.ray.intersectPlane(plane, intersect)) {
                            dragStartMouseAngle = Math.atan2(intersect.x, intersect.z) * (180 / Math.PI);
                            if (dragStartMouseAngle < 0) dragStartMouseAngle += 360;
                        }
                        dragStartValue = valuesRef.current.horizontal;
                    } else if (h.name === 'elevation') {
                        const elevPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -ELEV_ARC_X);
                        const intersect = new THREE.Vector3();
                        if (raycaster.ray.intersectPlane(elevPlane, intersect)) {
                            const relY = intersect.y - CENTER.y;
                            const relZ = intersect.z;
                            dragStartMouseAngle = Math.atan2(relY, relZ) * (180 / Math.PI);
                        }
                        dragStartValue = valuesRef.current.vertical;
                    } else if (h.name === 'distance') {
                        dragStartMouseY = mouse.y;
                        dragStartValue = valuesRef.current.zoom;
                    }
                    return;
                }
            }
        };

        const onPointerMove = (event: MouseEvent) => {
            getMousePos(event);
            raycaster.setFromCamera(mouse, camera);

            if (!isDragging) {

                const handles = [
                    { mesh: azimuthHandle, glow: azGlow, name: 'azimuth' },
                    { mesh: elevationHandle, glow: elGlow, name: 'elevation' },
                    { mesh: distanceHandle, glow: distGlow, name: 'distance' }
                ];

                let foundHover: { mesh: THREE.Mesh; glow: THREE.Mesh; name: string } | null = null;
                for (const h of handles) {
                    if (raycaster.intersectObject(h.mesh).length > 0) {
                        foundHover = h;
                        break;
                    }
                }


                handles.forEach(h => setHandleScale(h.mesh, h.glow, 1.0));

                if (foundHover) {
                    setHandleScale(foundHover.mesh, foundHover.glow, 1.15);
                    renderer.domElement.style.cursor = 'grab';
                    setHoveredHandle(foundHover.name);
                } else {
                    renderer.domElement.style.cursor = 'default';
                    setHoveredHandle(null);
                }
                return;
            }


            const plane = new THREE.Plane();
            const intersect = new THREE.Vector3();

            if (currentDragTarget === 'azimuth') {
                plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0));
                if (raycaster.ray.intersectPlane(plane, intersect)) {
                    let currentMouseAngle = Math.atan2(intersect.x, intersect.z) * (180 / Math.PI);
                    if (currentMouseAngle < 0) currentMouseAngle += 360;

                    let angleDiff = currentMouseAngle - dragStartMouseAngle;

                    if (angleDiff > 180) angleDiff -= 360;
                    if (angleDiff < -180) angleDiff += 360;
                    let newAngle = dragStartValue + angleDiff;

                    newAngle = ((newAngle % 360) + 360) % 360;
                    valuesRef.current.horizontal = newAngle;
                    updateVisuals();
                    setValues({ ...valuesRef.current });
                    const prompt = generatePrompt(valuesRef.current.horizontal, valuesRef.current.vertical, valuesRef.current.zoom);
                    if (onChange) onChange(prompt, { ...valuesRef.current });
                }
            } else if (currentDragTarget === 'elevation') {
                const elevPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), -ELEV_ARC_X);
                if (raycaster.ray.intersectPlane(elevPlane, intersect)) {
                    const relY = intersect.y - CENTER.y;
                    const relZ = intersect.z;
                    let currentMouseAngle = Math.atan2(relY, relZ) * (180 / Math.PI);

                    const angleDiff = currentMouseAngle - dragStartMouseAngle;
                    let newAngle = dragStartValue + angleDiff;
                    newAngle = Math.max(-30, Math.min(90, newAngle));
                    valuesRef.current.vertical = newAngle;
                    updateVisuals();
                    setValues({ ...valuesRef.current });
                    const prompt = generatePrompt(valuesRef.current.horizontal, valuesRef.current.vertical, valuesRef.current.zoom);
                    if (onChange) onChange(prompt, { ...valuesRef.current });
                }
            } else if (currentDragTarget === 'distance') {

                const mouseDeltaY = mouse.y - dragStartMouseY;
                const newDist = dragStartValue - mouseDeltaY * 8;
                valuesRef.current.zoom = Math.max(0, Math.min(10, newDist));
                updateVisuals();
                setValues({ ...valuesRef.current });
                const prompt = generatePrompt(valuesRef.current.horizontal, valuesRef.current.vertical, valuesRef.current.zoom);
                if (onChange) onChange(prompt, { ...valuesRef.current });
            }
        };

        const onPointerUp = () => {
            if (isDragging) {
                const handles = [
                    { mesh: azimuthHandle, glow: azGlow },
                    { mesh: elevationHandle, glow: elGlow },
                    { mesh: distanceHandle, glow: distGlow }
                ];
                handles.forEach(h => setHandleScale(h.mesh, h.glow, 1.0));
            }
            isDragging = false;
            currentDragTarget = null;
            setDragTarget(null);
            renderer.domElement.style.cursor = 'default';
        };


        renderer.domElement.addEventListener('mousedown', onPointerDown);
        renderer.domElement.addEventListener('mousemove', onPointerMove);
        renderer.domElement.addEventListener('mouseup', onPointerUp);
        renderer.domElement.addEventListener('mouseleave', onPointerUp);


        renderer.domElement.addEventListener('touchstart', (e) => {
            e.preventDefault();
            onPointerDown({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
        }, { passive: false });

        renderer.domElement.addEventListener('touchmove', (e) => {
            e.preventDefault();
            onPointerMove({ clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
        }, { passive: false });

        renderer.domElement.addEventListener('touchend', onPointerUp);


        let time = 0;
        const animate = () => {
            animationIdRef.current = requestAnimationFrame(animate);
            time += 0.01;


            if (camGlowRef.current) {
                const pulse = 1 + Math.sin(time * 2) * 0.03;
                camGlowRef.current.scale.setScalar(pulse);
            }


            glowRing.rotation.z += 0.003;

            renderer.render(scene, camera);
        };
        animate();


        const onResize = () => {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        window.addEventListener('resize', onResize);

        const resizeObserver = new ResizeObserver(() => {
            onResize();
        });
        resizeObserver.observe(container);


        return () => {
            cancelAnimationFrame(animationIdRef.current);
            window.removeEventListener('resize', onResize);
            resizeObserver.disconnect();
            renderer.domElement.removeEventListener('mousedown', onPointerDown);
            renderer.domElement.removeEventListener('mousemove', onPointerMove);
            renderer.domElement.removeEventListener('mouseup', onPointerUp);
            renderer.domElement.removeEventListener('mouseleave', onPointerUp);
            renderer.dispose();
            if (container.contains(renderer.domElement)) {
                container.removeChild(renderer.domElement);
            }
        };
    }, [imageUrl, updateVisuals, generatePrompt, onChange]);


    const handleReset = () => {
        updateValues({ horizontal: 0, vertical: 0, zoom: 5 });
        updateVisuals();
    };


    useEffect(() => {
        const prompt = generatePrompt(initialValues.horizontal, initialValues.vertical, initialValues.zoom);
        if (onChange) {
            onChange(prompt, initialValues);
        }
    }, []);

    return (
        <div className="maw-container">

            <div
                ref={containerRef}
                className="maw-canvas"
            />

            <style>{`
                .maw-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #0a0a0f;
                    border-radius: 8px;
                    overflow: hidden;
                }

                .maw-canvas {
                    flex: 1;
                    min-height: 500px;
                }
            `}</style>
        </div>
    );
};

export default MultiAngle3DController;
