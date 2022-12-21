import { useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ShaderPass,
  KernelSize,
  MipmapBlurPass,
  KawaseBlurPass,
  EffectPass,
  BloomEffect,
  BlendMode,
  BlendFunction,
  LUT3DEffect,
  LookupTexture3D,
} from "postprocessing";
import customVert from "./customPass.vert"
import customFrag from "./customPass.frag"
import { useTexture } from "@react-three/drei";

const customPassMaterial = new THREE.ShaderMaterial({
  uniforms: {
    u_time: new THREE.Uniform(0),
    u_diffuse: new THREE.Uniform(null),
    u_blurredNormalDirect: new THREE.Uniform(null),
    u_blurredPositionFresnel: new THREE.Uniform(null),
    u_worldPositionMap: new THREE.Uniform(null),
    u_lut: new THREE.Uniform(null),
    u_envDiffuse: new THREE.Uniform(null),
    u_envSpecular: new THREE.Uniform(null),
    u_distortion: new THREE.Uniform(null),
  },
  vertexShader: customVert,
  fragmentShader: customFrag,
})

function usePostprocessing({ lut, envDiffuse, envSpecular }) {
  const { gl, scene, camera, size } = useThree();

  const lutTexture = useTexture("/lut/filmic2.png")
  const distortionTexture = useTexture("/distortion.jpg")
  distortionTexture.wrapS = distortionTexture.wrapT = THREE.RepeatWrapping

  const buffers = useState(() => {
    const rt = new THREE.WebGLRenderTarget(
      window.innerWidth * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        stencilBuffer: false,
        depthBuffer:  false,
        type: THREE.HalfFloatType
      }
    )
    return [rt.clone(), rt.clone(), rt.clone()]
  })[0]

  const rt = useState(() => {
    const renderTarget = new THREE.WebGLMultipleRenderTargets(
      window.innerWidth * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
      3
    );
    
    renderTarget.texture[ 0 ].minFilter = THREE.LinearMipmapLinearFilter;
    renderTarget.texture[ 0 ].magFilter = THREE.LinearFilter;
    renderTarget.texture[ 0 ].generateMipmaps = true
    
    renderTarget.texture[ 1 ].minFilter = THREE.NearestFilter;
    renderTarget.texture[ 1 ].magFilter = THREE.NearestFilter;
    renderTarget.texture[ 2 ].minFilter = THREE.NearestFilter;
    renderTarget.texture[ 2 ].magFilter = THREE.NearestFilter;
    
    renderTarget.texture[ 0 ].name = 'diffuse';
    renderTarget.texture[ 1 ].name = 'normal';
    renderTarget.texture[ 2 ].name = 'position';

    renderTarget.samples = 4
    
    return renderTarget
  })[0];

  const pipeline = useMemo(() => {
    const CUSTOM = new ShaderPass(customPassMaterial, 'u_diffuse')
    
    const MMBLUR = new MipmapBlurPass()
    MMBLUR.levels = 4

    const BLUR = new KawaseBlurPass()
    BLUR.scale = 3
    BLUR.kernelSize = KernelSize.VERY_LARGE

    const BLOOM = new BloomEffect({
      mipmapBlur: true,
      radius: 1,
      intensity: 2,
      luminanceThreshold: 0.1,
      luminanceSmoothing: 0.02,
    })
    const BLOOM2 = new BloomEffect({
      mipmapBlur: true,
      radius: 0.1,
      intensity: 1,
      luminanceThreshold: 0.6,
      luminanceSmoothing: 0.1,
    })
    BLOOM.inputColorSpace = THREE.LinearEncoding
    BLOOM.outputColorSpace = THREE.sRGBEncoding
    
    const lut = LookupTexture3D.from(lutTexture);
		const LUT = new LUT3DEffect(lut)

    const EFX = new EffectPass(camera, BLOOM, BLOOM2)
    EFX.initialize(gl, 0, THREE.HalfFloatType);

    return [CUSTOM, BLUR, MMBLUR, EFX];
  }, [gl, scene, camera, rt]);

  const [outputNormBuffer, outputPosBuffer, buffer] = buffers
  const [customPass, blurPass, mmBlurPass, efxPass] = pipeline

  useEffect(() => {
    pipeline.forEach(el => el.setSize(size.width, size.height));
    buffers.forEach(el => el.setSize(size.width, size.height));
    rt.setSize(size.width, size.height)
  }, [
    size.width,
    size.height,
    pipeline,
    rt,
    buffers,
  ])

  useFrame((_, delta) => {
    // renders the main scene with the WebGLMultipleRenderTargets
    gl.setRenderTarget( rt );
    gl.render( scene, camera ); 
    
    // mipmap blur for the color texture
    mmBlurPass.render(gl, {
      texture: rt.texture[ 0 ],
      width: rt.width,
      height: rt.height
    }, null, delta, false)
    rt.texture[ 0 ].mipmaps = mmBlurPass.downsamplingMipmaps
    
    // blurs for the normal texture
    blurPass.render(gl, {
      texture: rt.texture[ 1 ],
    }, outputNormBuffer, delta, false)
    
    // blurs for the world position texture
    blurPass.render(gl, {
      texture: rt.texture[ 2 ],
    }, outputPosBuffer, delta, false)
    
    customPassMaterial.uniforms.u_time.value += delta
    customPassMaterial.uniforms.u_distortion.value = distortionTexture
    customPassMaterial.uniforms.u_diffuse.value = rt.texture[ 0 ]
    customPassMaterial.uniforms.u_worldPositionMap.value = rt.texture[ 2 ]
    customPassMaterial.uniforms.u_blurredNormalDirect.value = outputNormBuffer.texture
    customPassMaterial.uniforms.u_blurredPositionFresnel.value = outputPosBuffer.texture
    customPassMaterial.uniforms.u_lut.value = lut
    customPassMaterial.uniforms.u_envDiffuse.value = envDiffuse
    customPassMaterial.uniforms.u_envSpecular.value = envSpecular
    
    // renders the clearcoat-wrapper effect on the original color texture
    customPass.render(gl, null, buffer, delta, false)

    // adds postprocessing efx
    efxPass.render(gl, buffer, null, delta, false)
  }, 1);
}

export default usePostprocessing;
