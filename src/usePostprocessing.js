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

const myShaderMaterial = new THREE.ShaderMaterial({
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
  const [outputNormBuffer, outputPosBuffer, buffer] = buffers

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
    const CUSTOM = new ShaderPass(myShaderMaterial, 'u_diffuse')
    
    const MMBLUR = new MipmapBlurPass()
    MMBLUR.levels = 4

    const BLUR = new KawaseBlurPass()
    BLUR.scale = 3
    BLUR.kernelSize = KernelSize.VERY_LARGE

    const BLOOM = new BloomEffect()
    BLOOM.blendMode = new BlendMode(BlendFunction.COLOR_DODGE)
    BLOOM.resolution.height = 360;
    BLOOM.blurPass.kernelSize = 1;
    BLOOM.blurPass.scale = 1;
    BLOOM.intensity = 0.8
    BLOOM.luminanceMaterial.threshold = 0.3;
    BLOOM.luminanceMaterial.smoothing = 0.1;
    BLOOM.inputColorSpace = THREE.LinearEncoding
    BLOOM.outputColorSpace = THREE.sRGBEncoding
    
    const lut = LookupTexture3D.from(lutTexture);
		const LUT = new LUT3DEffect(lut)

    const EFX = new EffectPass(camera, BLOOM, LUT)
    EFX.initialize(gl, 0, THREE.HalfFloatType);

    return [CUSTOM, BLUR, MMBLUR, EFX];
  }, [gl, scene, camera, rt]);

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
    gl.setRenderTarget( rt );
    gl.render( scene, camera ); 
    
    mmBlurPass.render(gl, {
      texture: rt.texture[ 0 ],
      width: rt.width,
      height: rt.height
    }, null, delta, false)
    rt.texture[ 0 ].mipmaps = mmBlurPass.downsamplingMipmaps

    blurPass.render(gl, {
      texture: rt.texture[ 1 ],
    }, outputNormBuffer, delta, false)
    
    blurPass.render(gl, {
      texture: rt.texture[ 2 ],
    }, outputPosBuffer, delta, false)
    
    myShaderMaterial.uniforms.u_time.value += delta
    myShaderMaterial.uniforms.u_distortion.value = distortionTexture
    myShaderMaterial.uniforms.u_diffuse.value = rt.texture[ 0 ]
    myShaderMaterial.uniforms.u_worldPositionMap.value = rt.texture[ 2 ]
    myShaderMaterial.uniforms.u_blurredNormalDirect.value = outputNormBuffer.texture
    myShaderMaterial.uniforms.u_blurredPositionFresnel.value = outputPosBuffer.texture
    myShaderMaterial.uniforms.u_lut.value = lut
    myShaderMaterial.uniforms.u_envDiffuse.value = envDiffuse
    myShaderMaterial.uniforms.u_envSpecular.value = envSpecular
    
    customPass.render(gl, null, buffer, delta, false)
    efxPass.render(gl, buffer, null, delta, false)
  }, 1);
}

export default usePostprocessing;
