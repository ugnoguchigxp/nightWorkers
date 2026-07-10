import { type ReactNode, useState } from "react";

export function LazyDetails({
	children,
	summary,
	className,
	defaultOpen = false,
}: {
	children: ReactNode;
	summary: ReactNode;
	className?: string;
	defaultOpen?: boolean;
}) {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	const [hasOpened, setHasOpened] = useState(defaultOpen);
	return (
		<details
			className={className}
			open={isOpen}
			onToggle={(event) => {
				setIsOpen(event.currentTarget.open);
				if (event.currentTarget.open) setHasOpened(true);
			}}
		>
			{summary}
			{hasOpened ? children : null}
		</details>
	);
}
