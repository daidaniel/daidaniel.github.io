import * as React from "react";
import QK65 from "../images/qk65.png";

const Hero = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-900 pt-16">
      <div className="flex w-full max-w-7xl flex-col items-center p-4 xl:flex-row xl:justify-between">
        <div className="max-w-md text-center text-zinc-50 xl:text-left">
          <h1 className="mb-6 text-5xl font-semibold xl:text-6xl">
            Daniel Dai
          </h1>
          <p className="mb-8 xl:text-lg">
            CS major at UCLA. Aspiring front-end developer. Hobbyist UI
            designer. Mechanical keyboard enthusiast. Passionate problem solver.
            Lifelong learner and self-starter.
          </p>
          <a
            href="/DanielDai_Resume.pdf"
            class="rounded bg-amber-300 px-6 py-2 font-semibold text-zinc-950 hover:bg-amber-500 xl:text-lg"
          >
            Résumé
          </a>
        </div>
        <img src={QK65} alt="QK65" className="mt-16 w-full max-w-2xl xl:mt-0" />
      </div>
    </div>
  );
};

export default Hero;
