
import type { CustomComponents } from "react-day-picker";

declare module "react-day-picker" {
  interface CustomComponents {
    IconLeft?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    IconRight?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  }
}
