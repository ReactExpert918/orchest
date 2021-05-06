import { styled } from "../core";

export const Link = styled("a", {
  variants: {
    variant: {
      inline: {
        appearance: "none",
        backgroundColor: "transparent",
        border: 0,
        flexShrink: 0,
        color: "$link",
        WebkitTapHighlightColor: "rgba(0,0,0,0)",
        textDecorationLine: "underline",
        textUnderlineOffset: "3px",
        textDecorationColor: "currentColor",
        cursor: "pointer",
        "&:hover": {
          color: "$linkHover",
        },
      },
    },
  },
  defaultVariants: {
    variant: "inline",
  },
});
