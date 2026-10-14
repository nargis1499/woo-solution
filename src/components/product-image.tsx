import Image from "next/image";
import { cn } from "@/lib/utils";
import { BagIcon } from "./icons";

export function ProductImage({
  src,
  alt,
  sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw",
  priority,
  className,
}: {
  src: string | null;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-square w-full overflow-hidden bg-neutral-100", className)}>
      {src ? (
        <Image src={src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <div className="grid h-full w-full place-items-center text-neutral-300">
          <BagIcon className="h-12 w-12" />
        </div>
      )}
    </div>
  );
}
