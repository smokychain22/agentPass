import { cn } from "@/lib/utils";

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
  id?: string;
}

export function Container({ children, className, as: Tag = "div", id }: ContainerProps) {
  return (
    <Tag id={id} className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>
      {children}
    </Tag>
  );
}
