import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useControls } from "leva";
import { useNormalTexture, useTexture } from "@react-three/drei";
import palettes from "nice-color-palettes"

import usePostprocessing from "./usePostprocessing";
import vertexShader from "./shader.vert";
import vertexShaderShadow from "./shadow.vert";
import fragmentShader from "./shader.frag";

const rand = Math.random();

const _c = new THREE.Color()

const _e = new THREE.Euler();

const _mouse = new THREE.Vector2();

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();

const _p0 = new THREE.Vector3();
const _ps0 = new THREE.Vector4();

const _p1 = new THREE.Vector3();
const _ps1 = new THREE.Vector4();

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();

const _temp3 = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _relativeVelocity = new THREE.Vector3();

const _collider0 = new THREE.Sphere(new THREE.Vector3(), 1);
const _collider1 = new THREE.Sphere(new THREE.Vector3(), 1);

const BALLS_NUM = 40

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
canvas.width = canvas.height = 512;
const imageData = ctx.createImageData(512, 512);
for (let i = 0; i < imageData.data.length; i += 4) {
	imageData.data[i] = ~~(Math.random() * 256);
	imageData.data[i + 1] = ~~(Math.random() * 256);
	imageData.data[i + 2] = 255//~~(Math.random() * 256);
	imageData.data[i + 3] = 255;
}
ctx.putImageData(imageData, 0, 0);
const noiseTexture = new THREE.CanvasTexture(canvas);
noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
noiseTexture.minFilter = THREE.NearestFilter;
noiseTexture.magFilter = THREE.NearestFilter;
noiseTexture.needsUpdate = true;


export default function Model() {
  const [mesh, setMesh] = useState();
  
  const geometry = useState(() => {
		const refGeometry = new THREE.OctahedronGeometry(1, 8);
		const geometry = new THREE.InstancedBufferGeometry();
		for (let id in refGeometry.attributes) {
			geometry.setAttribute(id, refGeometry.attributes[id]);
		}

		const instanceIds = new Float32Array(BALLS_NUM);
		const instancePositionsScale = new Float32Array(BALLS_NUM * 4);
		const instanceRotations = new Float32Array(BALLS_NUM * 4);
		const instanceVelocities = new Float32Array(BALLS_NUM * 3);
		const instanceRands = new Float32Array(BALLS_NUM * 4);
		const instanceColors = new Float32Array(BALLS_NUM * 3);

		for (let i = 0, i3 = 0, i4 = 0; i < BALLS_NUM; i++, i3 += 3, i4 += 4) {
			instanceIds[i] = i;
			
      instancePositionsScale[i4 + 0] = Math.random() - 0.5;
			instancePositionsScale[i4 + 1] = Math.random() - 0.5;
			instancePositionsScale[i4 + 2] = Math.random() - 0.5;
			instancePositionsScale[i4 + 3] = 0.22 * (0.5 + 0.5 * Math.random());
			
      instanceRands[i4 + 0] = 2 * (Math.random() - 0.5);
			instanceRands[i4 + 1] = 2 * (Math.random() - 0.5);
			instanceRands[i4 + 2] = 2 * (Math.random() - 0.5);
			instanceRands[i4 + 3] = 2 * (Math.random() - 0.5);
			
      instanceVelocities[i3 + 0] = 2 * (Math.random() - 0.5)
			instanceVelocities[i3 + 1] = 2 * (Math.random() - 0.5)
			instanceVelocities[i3 + 2] = 2 * (Math.random() - 0.5)
      
      instanceColors[i3 + 0] = 1
			instanceColors[i3 + 1] = 1
			instanceColors[i3 + 2] = 1
      
      _e.set(2 * Math.PI * Math.random(), 2 * Math.PI * Math.random(), 2 * Math.PI * Math.random())
      _q0.setFromEuler(_e)
      instanceRotations[i4 + 0] = _q0.x
			instanceRotations[i4 + 1] = _q0.y
			instanceRotations[i4 + 2] = _q0.z
			instanceRotations[i4 + 3] = _q0.w
		}

		geometry.index = refGeometry.index;
		geometry.setAttribute('a_instanceId', new THREE.InstancedBufferAttribute(instanceIds, 1));
		geometry.setAttribute('a_instancePositionScale', new THREE.InstancedBufferAttribute(instancePositionsScale, 4));
		geometry.setAttribute('a_instanceVelocity', new THREE.InstancedBufferAttribute(instanceVelocities, 3));
		geometry.setAttribute('a_instanceColor', new THREE.InstancedBufferAttribute(instanceColors, 3));
		geometry.setAttribute('a_instanceRotation', new THREE.InstancedBufferAttribute(instanceRotations, 4));
		geometry.setAttribute('a_instanceRands', new THREE.InstancedBufferAttribute(instanceRands, 4));
    
    return geometry
  })[0]

  const customDepthMaterial = useState(() => {
    const customDepthMaterial = new THREE.MeshDepthMaterial();
     
    customDepthMaterial.type = 'ShaderMaterial';
    customDepthMaterial.uniforms = THREE.UniformsUtils.merge([THREE.ShaderLib.depth.uniforms]);
    customDepthMaterial.vertexShader = vertexShaderShadow;
    customDepthMaterial.fragmentShader = THREE.ShaderLib.depth.fragmentShader;
    customDepthMaterial.depthPacking = THREE.RGBADepthPacking;

    return customDepthMaterial
  })[0]
  
  const uniforms = useMemo(
    () => Object.assign(
      THREE.UniformsUtils.merge([THREE.UniformsLib.lights]),
      {
        u_dt: { value: 0 },
        u_time: { value: 0 },
        
        u_color: { value: new THREE.Color() },
        
        u_lut: { value: null },
        u_envDiffuse: {value: null},
        u_envSpecular: {value: null},
        
        u_normalMap: { value: null },
        u_sparklesMap: { value: null },
        u_normalScale: { value: new THREE.Vector2(1, 1) },
        u_repeat: { value: new THREE.Vector2(1, 1) },        
      }
    ),
    []
  );

  const { palette, normalScale, normalId, repeat } = useControls({
    palette: { min: 0, max: 99, step: 1, value: 10 },
    normalId: { min: 1, max: 75, step: 1, value: 73 },
    normalScale: { min: 0, max: 2, step: 0.0001, value: 1.5 },
    repeat: { min: 1, max: 16, step: 0.0001, value: 3.5 },
  });
  
  const [lut, envDiffuse, envSpecular] = useTexture([
    "/lut.png",
    "/env_diffuse.png",
    "/env_specular.png",
  ])
  const [normalMap] = useNormalTexture(normalId)

  usePostprocessing({ lut, envDiffuse, envSpecular });

  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping

  lut.generateMipmaps = false;
  lut.flipY = true;
  lut.needsUpdate = true;

  envDiffuse.generateMipmaps = false;
  envDiffuse.flipY = true;
  envDiffuse.needsUpdate = true;

  envSpecular.generateMipmaps = false;
  envSpecular.flipY = true;
  envSpecular.needsUpdate = true;

  useEffect(() => {
    if (!mesh) return

    const colors = palettes[palette]
    const { a_instanceColor } = mesh.geometry.attributes
    for (let i = 0; i < BALLS_NUM; i++ ) {
      _c.set(colors[i % 5])
      a_instanceColor.array[i * 3 + 0] = _c.r
      a_instanceColor.array[i * 3 + 1] = _c.g
      a_instanceColor.array[i * 3 + 2] = _c.b
    }
    a_instanceColor.needsUpdate = true
  }, [palette, mesh])

  useFrame(({ mouse }, dt) => {
    mesh.material.uniforms.u_dt.value = dt;
    mesh.material.uniforms.u_time.value += dt;
    mesh.material.uniforms.u_sparklesMap.value = noiseTexture;
    mesh.material.uniforms.u_normalMap.value = normalMap;
    mesh.material.uniforms.u_normalScale.value.setScalar(normalScale);
    mesh.material.uniforms.u_repeat.value.setScalar(repeat);
    mesh.material.uniforms.u_lut.value = lut;
    mesh.material.uniforms.u_envDiffuse.value = envDiffuse;
    mesh.material.uniforms.u_envSpecular.value = envSpecular;

    const { a_instancePositionScale, a_instanceRotation, a_instanceVelocity, a_instanceRands } = mesh.geometry.attributes

    for (let i = 0; i < BALLS_NUM; i++ ) {
      _ps0.fromBufferAttribute(a_instancePositionScale, i);
      _v0.fromBufferAttribute(a_instanceVelocity, i);
      _q1.fromBufferAttribute(a_instanceRotation, i)

      _p0.set(_ps0.x, _ps0.y, _ps0.z)
      _p0.addScaledVector(_v0, dt)
      
      _collider0.center.copy(_p0);
      _collider0.radius = _ps0.w

      _v0.multiplyScalar(Math.pow(0.8, dt));

      for ( let j = i + 1; j < BALLS_NUM; j++ ) {
        _ps1.fromBufferAttribute(a_instancePositionScale, j);
        _v1.fromBufferAttribute(a_instanceVelocity, j);
        _p1.set(_ps1.x, _ps1.y, _ps1.z)
        _p1.addScaledVector(_v1, dt)
        _collider1.center.copy(_p1);
        _collider1.radius = _ps1.w

        _normal.copy( _p0 ).sub( _p1 );

        const distance = _normal.length();

        if ( distance < 0.98 * (_collider0.radius + _collider1.radius) ) {
          _normal.multiplyScalar( 0.5 * (distance - 0.98 * (_collider0.radius + _collider1.radius)) );
          _p0.sub( _normal );
          _p1.add( _normal );
          _normal.normalize();
          _relativeVelocity.copy( _v0 ).sub( _v1 );
          _normal.multiplyScalar( _relativeVelocity.dot( _normal ) );
          _v0.sub( _normal );
          _v1.add( _normal );
          _v0.multiplyScalar(0.9)
        }
      }

      _ps1.set(2 * mouse.x, 2 * mouse.y, 0, 0.5)
      _p1.set(_ps1.x, _ps1.y, _ps1.z)
      _v1.set((_ps1.x - _mouse.x) / dt, (_ps1.y - _mouse.y) / dt, 0)
      _mouse.set(_p1.x, _p1.y)
      _collider1.center.copy(_p1);
      _collider1.radius = _ps1.w
      _normal.copy( _p0 ).sub( _p1 );

      const distance = _normal.length();
      if ( distance < 0.98 * (_collider0.radius + _collider1.radius) ) {
        _normal.multiplyScalar( 0.5 * (distance - 0.98 * (_collider0.radius + _collider1.radius)) );
        _p0.sub( _normal );
        _normal.normalize();
        _relativeVelocity.copy( _v0 ).sub( _v1 );
        _normal.multiplyScalar(2 * _relativeVelocity.dot( _normal ) );
        _v0.sub( _normal );
      }
      
      const speed = _v0.length();
      const angle = 5 * speed * dt;
      
      _temp3.fromBufferAttribute(a_instanceRands, i)
      _temp3.normalize()
      _temp3.multiplyScalar(Math.sin(angle));

      _q0.x = _temp3.x;
      _q0.y = _temp3.y;
      _q0.z = _temp3.z;
      _q0.w = Math.cos(angle);
      _q0.multiply(_q1);
      
      a_instancePositionScale.array[i * 4 + 0] = _p0.x
      a_instancePositionScale.array[i * 4 + 1] = _p0.y
      a_instancePositionScale.array[i * 4 + 2] = _p0.z

      const dist = _p0.length()
      _p0.negate().normalize()
      _v0.lerp(_p0, dist * 0.1)

      a_instanceVelocity.array[i * 3 + 0] = _v0.x
      a_instanceVelocity.array[i * 3 + 1] = _v0.y
      a_instanceVelocity.array[i * 3 + 2] = _v0.z

      a_instanceRotation.array[i * 4 + 0] = _q0.x
      a_instanceRotation.array[i * 4 + 1] = _q0.y
      a_instanceRotation.array[i * 4 + 2] = _q0.z
      a_instanceRotation.array[i * 4 + 3] = _q0.w
    }

    a_instanceRotation.needsUpdate = true
    a_instancePositionScale.needsUpdate = true
    a_instanceVelocity.needsUpdate = true

  });

  return (
    <>
    <mesh ref={setMesh} geometry={geometry} frustumCulled={false} receiveShadow castShadow customDepthMaterial={customDepthMaterial}  >
      <shaderMaterial
        key={rand}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        glslVersion={THREE.GLSL3}
        lights
      />
    </mesh>
    </>
  );
}
