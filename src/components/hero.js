import * as React from "react";
import QK65 from "../images/qk65.png";

const Hero = () => {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-900">
      <div className="h-16" />
      <div className="flex grow items-center justify-center">
        <div className="flex w-full max-w-7xl flex-col items-center justify-between p-4 xl:flex-row">
          <div className="max-w-md text-center text-zinc-50 xl:text-left">
            <h1 className="mb-6 text-6xl font-bold">Daniel Dai</h1>
            <p className="text-lg">
              Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do
              eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut
              enim ad minim veniam, quis nostrud exercitation ullamco laboris
              nisi ut aliquip ex ea commodo consequat.
            </p>
          </div>
          <img
            src={QK65}
            alt="QK65"
            className="mt-10 w-full max-w-2xl xl:mt-0"
          />
        </div>
      </div>
    </div>
  );
};

export default Hero;
