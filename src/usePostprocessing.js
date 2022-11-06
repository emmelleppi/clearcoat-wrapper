import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  ShaderPass,
  KernelSize,
  MipmapBlurPass,
  KawaseBlurPass,
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

  const [outputNormBuffer, outputPosBuffer] = useState(() => {
    const rt = new THREE.WebGLRenderTarget(
      window.innerWidth * window.devicePixelRatio,
      window.innerHeight * window.devicePixelRatio,
    )
    return [rt.clone(), rt.clone()]
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

  const [customPass, blurPass, mmBlurPass] = useMemo(() => {
    const CUSTOM = new ShaderPass(myShaderMaterial, 'u_diffuse')
    
    const MMBLUR = new MipmapBlurPass()
    MMBLUR.levels = 4

    const BLUR = new KawaseBlurPass()
    BLUR.scale = 3
    BLUR.kernelSize = KernelSize.VERY_LARGE
    
    return [CUSTOM, BLUR, MMBLUR];
  }, [gl, scene, camera, rt]);

  useEffect(() => {
    customPass.setSize(size.width, size.height)
    blurPass.setSize(size.width, size.height)
    outputNormBuffer.setSize(size.width, size.height)
    outputPosBuffer.setSize(size.width, size.height)
    mmBlurPass.setSize(size.width, size.height)
  }, [
    size.width,
    size.height,
    customPass,
    blurPass,
    outputNormBuffer,
    outputPosBuffer,
    mmBlurPass,
  ])

  const distortionTexture = useTexture("/distortion.jpg")
  distortionTexture.wrapS = distortionTexture.wrapT = THREE.RepeatWrapping

  const blur = useCallback((texture, outputBuffer) => {
    const kernelSequence = blurPass.blurMaterial.kernelSequence;

    let previousTexture = texture
		blurPass.fullscreenMaterial = blurPass.blurMaterial;
 
		for(let i = 0, l = kernelSequence.length; i < l; ++i) {
			const buffer = ((i & 1) === 0) ? blurPass.renderTargetA : blurPass.renderTargetB;
			blurPass.blurMaterial.kernel = kernelSequence[i];
			blurPass.blurMaterial.inputBuffer = previousTexture;
			gl.setRenderTarget(buffer);
			gl.render(blurPass.scene, blurPass.camera);
			previousTexture = buffer.texture;
		}
 
		blurPass.fullscreenMaterial = blurPass.copyMaterial;
		blurPass.copyMaterial.inputBuffer = previousTexture;
		gl.setRenderTarget(outputBuffer);
		gl.render(blurPass.scene, blurPass.camera);
  }, [blurPass, gl])

  useFrame((_, delta) => {
    gl.setRenderTarget( rt );
    gl.render( scene, camera ); 
    
    mmBlurPass.render(gl, {
      texture: rt.texture[ 0 ],
      width: rt.width,
      height: rt.height
    }, null, delta, false)
    
    rt.texture[ 0 ].mipmaps = mmBlurPass.downsamplingMipmaps
    
    blur(rt.texture[ 1 ], outputNormBuffer)
    blur(rt.texture[ 2 ], outputPosBuffer)
    
    myShaderMaterial.uniforms.u_time.value += delta
    myShaderMaterial.uniforms.u_distortion.value = distortionTexture
    myShaderMaterial.uniforms.u_diffuse.value = rt.texture[ 0 ]
    myShaderMaterial.uniforms.u_worldPositionMap.value = rt.texture[ 2 ]
    myShaderMaterial.uniforms.u_blurredNormalDirect.value = outputNormBuffer.texture
    myShaderMaterial.uniforms.u_blurredPositionFresnel.value = outputPosBuffer.texture
    myShaderMaterial.uniforms.u_lut.value = lut
    myShaderMaterial.uniforms.u_envDiffuse.value = envDiffuse
    myShaderMaterial.uniforms.u_envSpecular.value = envSpecular
    
    customPass.render(gl, null, null, delta, false)
  }, 1);
}

export default usePostprocessing;
