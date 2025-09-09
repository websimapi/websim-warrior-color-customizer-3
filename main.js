import * as THREE from 'three';

const vertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    
    uniform vec3 uColorFace;
    uniform vec3 uColorArmour;
    uniform vec3 uColorTrim;
    uniform vec3 uColorHair;
    uniform vec3 uColorOutline;

    uniform float uThresholdFace;
    uniform float uThresholdArmour;
    uniform float uThresholdTrim;
    uniform float uThresholdHair;
    uniform float uThresholdOutline;

    uniform bool uCleanPixels;

    // Palette based on the new source image
    const vec3 PALETTE_FACE    = vec3(1.0, 1.0, 0.0); // Yellow
    const vec3 PALETTE_ARMOUR  = vec3(0.0, 0.0, 1.0); // Blue
    const vec3 PALETTE_TRIM    = vec3(0.0, 1.0, 0.0); // Green
    const vec3 PALETTE_HAIR    = vec3(1.0, 0.0, 0.0); // Red
    const vec3 PALETTE_OUTLINE = vec3(0.0, 0.0, 0.0); // Black

    float getAlpha(vec2 uv) {
        return texture2D(uTexture, uv).a;
    }

    void main() {
        vec2 onePixel = 1.0 / uResolution;
        vec4 texColor = texture2D(uTexture, vUv);

        if (uCleanPixels) {
            // STEP 1: Edge-aware stray pixel removal.
            // This algorithm identifies pixels that are "outside" the main character body
            // by checking for a connection to the transparent background.
            
            float originalAlpha = texColor.a;
            float finalAlpha = originalAlpha;

            if (originalAlpha > 0.1) {
                // Check if a pixel is connected to the border (i.e., is "outside").
                // We trace paths to the image borders. If a path of mostly transparent pixels exists,
                // we consider this pixel to be outside.
                const int steps = 15; // How far to look for a connection to the border.
                const float alpha_threshold = 0.1;

                vec2 to_left = vec2(-1.0, 0.0) * onePixel;
                vec2 to_right = vec2(1.0, 0.0) * onePixel;
                vec2 to_up = vec2(0.0, 1.0) * onePixel;
                vec2 to_down = vec2(0.0, -1.0) * onePixel;

                float path_clarity[4];
                path_clarity[0] = 1.0; // left
                path_clarity[1] = 1.0; // right
                path_clarity[2] = 1.0; // up
                path_clarity[3] = 1.0; // down

                for (int i = 1; i <= steps; i++) {
                    path_clarity[0] *= (1.0 - getAlpha(vUv + to_left * float(i)));
                    path_clarity[1] *= (1.0 - getAlpha(vUv + to_right * float(i)));
                    path_clarity[2] *= (1.0 - getAlpha(vUv + to_up * float(i)));
                    path_clarity[3] *= (1.0 - getAlpha(vUv + to_down * float(i)));
                }
                
                // If any path is mostly clear (product of (1-alpha) is high), it's likely outside.
                float outside_metric = max(max(path_clarity[0], path_clarity[1]), max(path_clarity[2], path_clarity[3]));

                if (outside_metric > 0.9) { // High confidence that it's connected to outside
                    finalAlpha = 0.0;
                }
            }

            // Apply the cleaned alpha mask
            texColor.a = finalAlpha;
            
            // STEP 2: Clean up internal stray pixels (holes) using the new clean mask
            if (texColor.a > 0.5) {
                // If the pixel itself is transparent in the original, it could be a hole.
                if (originalAlpha < 0.5) { 
                    vec3 dominantColor = vec3(0.0);
                    float maxCount = 0.0;
                    
                    // Find dominant color in 3x3 neighborhood to fill holes
                    for (int i = -1; i <= 1; i++) {
                        for (int j = -1; j <= 1; j++) {
                            if (i == 0 && j == 0) continue;
                            vec2 neighborUv = vUv + onePixel * vec2(float(i), float(j));
                            vec4 neighborColor = texture2D(uTexture, neighborUv);
                            // Only consider neighbors that are part of the character
                            if (neighborColor.a > 0.5) {
                                float currentCount = 1.0;
                                // Check 3x3 around the neighbor to see how solid it is
                                for (int k = -1; k <= 1; k++) {
                                    for (int l = -1; l <= 1; l++) {
                                         vec4 sampleColor = texture2D(uTexture, neighborUv + onePixel * vec2(float(k), float(l)));
                                         if (sampleColor.a > 0.5 && distance(neighborColor.rgb, sampleColor.rgb) < 0.1) {
                                             currentCount += 1.0;
                                         }
                                    }
                                }
                                if (currentCount > maxCount) {
                                    maxCount = currentCount;
                                    dominantColor = neighborColor.rgb;
                                }
                            }
                        }
                    }
                     // Only overwrite if a dominant color was found
                    if (maxCount > 1.0) { // Require at least one solid neighbor
                        texColor.rgb = dominantColor;
                    }
                }
            }
        }

        if (texColor.a < 0.1) {
            discard;
        }

        vec3 finalColor = texColor.rgb;

        vec3 colors[5];
        colors[0] = PALETTE_FACE;
        colors[1] = PALETTE_ARMOUR;
        colors[2] = PALETTE_TRIM;
        colors[3] = PALETTE_HAIR;
        colors[4] = PALETTE_OUTLINE;

        float dists[5];
        dists[0] = distance(texColor.rgb, colors[0]);
        dists[1] = distance(texColor.rgb, colors[1]);
        dists[2] = distance(texColor.rgb, colors[2]);
        dists[3] = distance(texColor.rgb, colors[3]);
        dists[4] = distance(texColor.rgb, colors[4]);
        
        float min_dist = 10.0;
        int min_idx = -1;

        for (int i = 0; i < 5; i++) {
            if (dists[i] < min_dist) {
                min_dist = dists[i];
                min_idx = i;
            }
        }

        if (min_idx == 0) {
            if (min_dist < uThresholdFace) finalColor = uColorFace;
        } else if (min_idx == 1) {
            if (min_dist < uThresholdArmour) finalColor = uColorArmour;
        } else if (min_idx == 2) {
            if (min_dist < uThresholdTrim) finalColor = uColorTrim;
        } else if (min_idx == 3) {
            if (min_dist < uThresholdHair) finalColor = uColorHair;
        } else if (min_idx == 4) {
            if (min_dist < uThresholdOutline) finalColor = uColorOutline;
        }

        gl_FragColor = vec4(finalColor, texColor.a);
    }
`;

// Basic setup
const canvas = document.getElementById('main-canvas');
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
const scene = new THREE.Scene();

// Camera
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

// Texture and Material
const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load('warrior.png', (loadedTexture) => {
    // Pass texture resolution to the shader
    shaderMaterial.uniforms.uResolution.value.x = loadedTexture.image.width;
    shaderMaterial.uniforms.uResolution.value.y = loadedTexture.image.height;
});
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;

const shaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uTexture: { value: texture },
        uResolution: { value: new THREE.Vector2(1, 1) }, // Default, will be updated on load
        uColorFace: { value: new THREE.Color('#FFFF00') },
        uColorArmour: { value: new THREE.Color('#0000FF') },
        uColorTrim: { value: new THREE.Color('#00FF00') },
        uColorHair: { value: new THREE.Color('#FF0000') },
        uColorOutline: { value: new THREE.Color('#000000') },
        uThresholdFace: { value: 1.0 },
        uThresholdArmour: { value: 1.0 },
        uThresholdTrim: { value: 1.0 },
        uThresholdHair: { value: 1.0 },
        uThresholdOutline: { value: 1.0 },
        uCleanPixels: { value: true },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
});

// Geometry
const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, shaderMaterial);
scene.add(mesh);

// Handle Resize
function resize() {
    const { clientWidth, clientHeight } = container;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.updateProjectionMatrix();

    // Adjust plane to fit texture aspect ratio
    const imageAspect = 3 / 4; // width / height of the image
    const canvasAspect = clientWidth / clientHeight;
    mesh.scale.set(1, 1, 1);
    if (imageAspect > canvasAspect) {
        mesh.scale.set(1, canvasAspect / imageAspect, 1);
    } else {
        mesh.scale.set(imageAspect / canvasAspect, 1, 1);
    }
}

// Connect UI controls
const colorMappings = {
    'color-face': 'uColorFace',
    'color-armour': 'uColorArmour',
    'color-trim': 'uColorTrim',
    'color-hair': 'uColorHair',
    'color-outline': 'uColorOutline',
};

for (const [id, uniformName] of Object.entries(colorMappings)) {
    const input = document.getElementById(id);
    input.addEventListener('input', (event) => {
        shaderMaterial.uniforms[uniformName].value.set(event.target.value);
    });
}

// Connect individual slider controls
const thresholdMappings = {
    'threshold-face': 'uThresholdFace',
    'threshold-armour': 'uThresholdArmour',
    'threshold-trim': 'uThresholdTrim',
    'threshold-hair': 'uThresholdHair',
    'threshold-outline': 'uThresholdOutline',
};

for (const [id, uniformName] of Object.entries(thresholdMappings)) {
    const slider = document.getElementById(id);
    const valueSpan = document.getElementById(`threshold-value-${id.split('-')[1]}`);
    slider.addEventListener('input', (event) => {
        const threshold = parseFloat(event.target.value);
        shaderMaterial.uniforms[uniformName].value = threshold;
        if (valueSpan) {
            valueSpan.textContent = threshold.toFixed(2);
        }
    });
}

// Connect pixel cleanup toggle
const cleanPixelsToggle = document.getElementById('clean-pixels-toggle');
cleanPixelsToggle.addEventListener('change', (event) => {
    shaderMaterial.uniforms.uCleanPixels.value = event.target.checked;
});

// Remove old global slider logic if it's still there
const oldSliderControl = document.querySelector('.slider-control');
if (oldSliderControl && oldSliderControl.style.display !== 'none') {
    oldSliderControl.style.display = 'none';
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// Initial setup
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(container);
resize();
animate();