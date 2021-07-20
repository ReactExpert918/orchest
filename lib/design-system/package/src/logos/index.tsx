import * as React from "react";
import { styled } from "../core";
import type { ExtractVariants, ICSSProp } from "../types";

const LogoSvg = styled("svg", {
  include: "box",
  width: "100%",
  height: "auto",
  verticalAlign: "middle",
  color: "$logo",
});

export type ILogoRef = SVGSVGElement;
export interface ILogoProps extends ExtractVariants<typeof LogoSvg>, ICSSProp {}

export const LogoBrand = React.forwardRef<ILogoRef, ILogoProps>(
  (props, ref) => (
    <LogoSvg
      ref={ref}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 330 71"
      {...props}
    >
      <title>Orchest</title>
      <path
        d="M97.088 36.78c0-6.218 2.122-11.49 6.366-15.818 4.243-4.328 9.432-6.492 15.567-6.492 6.176 0 11.386 2.164 15.63 6.492 4.285 4.327 6.428 9.6 6.428 15.819 0 6.176-2.143 11.428-6.428 15.756-4.244 4.327-9.454 6.491-15.63 6.491-6.135 0-11.324-2.164-15.567-6.491-4.244-4.328-6.366-9.58-6.366-15.756v-.001zm10.525-11.785c-3.109 3.235-4.664 7.164-4.664 11.786 0 4.621 1.534 8.55 4.601 11.785 3.109 3.193 6.933 4.79 11.471 4.79 4.537 0 8.361-1.597 11.47-4.79 3.109-3.235 4.664-7.164 4.664-11.785 0-4.622-1.555-8.55-4.664-11.786-3.109-3.235-6.933-4.853-11.47-4.853-4.496 0-8.299 1.618-11.408 4.853zm48.656 22.689v10.714h-5.735V28.966h5.735v6.617c1.428-4.832 4.159-7.248 8.193-7.248 2.311 0 4.013.379 5.105 1.135l-.882 5.357a9.848 9.848 0 00-4.349-1.008c-2.689 0-4.706 1.281-6.05 3.844-1.345 2.521-2.017 5.861-2.017 10.02v.001zm22.866 7.059c-3.025-2.9-4.538-6.618-4.538-11.156s1.513-8.214 4.538-11.029c3.025-2.815 6.701-4.223 11.029-4.223 4.664 0 8.445 1.576 11.344 4.727l-4.348 3.656c-1.849-1.85-4.181-2.773-6.996-2.773-2.731 0-5.063.903-6.996 2.71-1.932 1.764-2.899 4.075-2.899 6.932 0 2.9.967 5.273 2.899 7.122 1.933 1.849 4.265 2.773 6.996 2.773 2.815 0 5.147-.966 6.996-2.899l4.411 3.655c-2.941 3.194-6.743 4.79-11.407 4.79-4.328 0-8.004-1.428-11.029-4.286v.001zm37.292-12.227v15.882h-5.735v-45.44h5.735v20.42c.799-1.64 2.143-2.879 4.034-3.72 1.933-.881 3.823-1.323 5.672-1.323 3.697 0 6.618 1.156 8.76 3.467 2.143 2.269 3.194 5.462 3.152 9.58v17.016h-5.736V41.76c0-2.395-.651-4.286-1.953-5.673-1.261-1.428-2.92-2.142-4.979-2.142-2.353 0-4.433.714-6.24 2.142-1.806 1.387-2.71 3.53-2.71 6.429zm36.496-1.135H271.2c-.336-2.437-1.323-4.348-2.962-5.735-1.597-1.428-3.592-2.143-5.987-2.143-2.479 0-4.58.715-6.303 2.143-1.68 1.387-2.689 3.298-3.025 5.735zm23.949 2.206c0 1.093-.021 1.849-.063 2.27h-23.886c.336 2.436 1.366 4.39 3.088 5.86 1.765 1.429 3.908 2.143 6.429 2.143 1.807 0 3.466-.399 4.979-1.197 1.512-.799 2.668-1.912 3.466-3.34.546.21 1.387.546 2.521 1.008 1.135.42 1.933.714 2.395.882-1.218 2.521-3.046 4.454-5.483 5.798-2.437 1.345-5.126 2.017-8.067 2.017-4.286 0-7.878-1.428-10.777-4.286-2.857-2.856-4.286-6.575-4.286-11.155 0-4.58 1.429-8.256 4.286-11.029 2.899-2.815 6.491-4.223 10.777-4.223 4.243 0 7.731 1.408 10.462 4.223 2.773 2.773 4.159 6.45 4.159 11.03v-.001zm15.861 1.828c-2.815-.756-4.895-1.89-6.239-3.403-1.345-1.513-1.891-3.572-1.639-6.177.21-2.142 1.303-3.928 3.278-5.357 1.974-1.428 4.285-2.143 6.932-2.143 2.731 0 5.042.694 6.933 2.08 1.933 1.345 3.025 3.425 3.277 6.24h-5.483c-.168-1.05-.693-1.87-1.576-2.458-.84-.589-1.848-.883-3.025-.883-1.092 0-2.059.252-2.899.757-.798.462-1.302 1.092-1.512 1.89-.253.925-.232 1.702.063 2.332.462.967 1.617 1.723 3.466 2.27l4.349 1.07c5.084 1.261 7.626 4.118 7.626 8.572 0 2.647-1.114 4.79-3.341 6.428-2.185 1.597-4.874 2.395-8.067 2.395-2.815 0-5.336-.861-7.563-2.584-2.185-1.723-3.319-4.012-3.403-6.87h5.231c.252 1.555 1.05 2.669 2.395 3.34 1.302.8 2.857 1.135 4.664 1.01 1.344-.085 2.416-.484 3.214-1.198.798-.715 1.218-1.597 1.26-2.647.042-1.009-.294-1.807-1.008-2.395-.714-.588-1.681-1.03-2.899-1.324l-4.034-.945zm30.848-16.45h6.239v4.853h-6.239v24.58h-5.735v-24.58h-5.295v-4.852h5.295V17.873h5.735v11.093-.001z"
        fill="currentColor"
      />
      <path
        d="M46 2.5H10A7.5 7.5 0 002.5 10v35a7.5 7.5 0 007.5 7.5h36a7.5 7.5 0 007.5-7.5V10A7.5 7.5 0 0046 2.5z"
        stroke="currentColor"
        strokeWidth="5"
      />
      <path
        d="M62 18.5H26a7.5 7.5 0 00-7.5 7.5v35a7.5 7.5 0 007.5 7.5h36a7.5 7.5 0 007.5-7.5V26a7.5 7.5 0 00-7.5-7.5z"
        stroke="currentColor"
        strokeWidth="5"
      />
    </LogoSvg>
  )
);
