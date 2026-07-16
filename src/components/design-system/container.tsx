import { cn } from "@/lib/utils";

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
  id?: string;
}

export function Container({ children, className, as: Tag = "div", id }: ContainerProps) {
  return (
    <Tag id={id} className={cn("mx-auto w-full max-w-[1360px] px-5 sm:px-8 lg:px-12", className)}>
      {children}
    </Tag>
  );
}
