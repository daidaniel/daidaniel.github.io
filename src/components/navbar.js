import * as React from "react";
import Logo from "../images/logo.inline.svg";

const Navbar = () => {
  return (
    <nav className="fixed top-0 z-40 w-full border-b border-zinc-600 bg-zinc-900">
      <div className="mx-auto flex h-16 max-w-7xl items-center p-4">
        <Logo className="h-10 w-10" />
      </div>
    </nav>
  );
};

export default Navbar;
