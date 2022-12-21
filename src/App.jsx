import React, { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import Test from "./Test";
import "./styles.css";

export default function App() {

  return (
    <div className="App">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 2], fov: 70, near: 0.01, far: 10 }}
        gl={{
          powerPreference: "high-performance",
          antialias: false,
          stencil: false,
          depth: false
        }}
        shadows
      >
        <Suspense fallback={null}>
          <Test />
        </Suspense>
        <directionalLight position={[5, 2, 2]} shadow-mapSize={[512, 512]} shadow-bias={-0.00004} castShadow>
          <orthographicCamera attach="shadow-camera" args={[-1, 1, -1, 1]} />
        </directionalLight>
      </Canvas>
    </div>
  );
}
