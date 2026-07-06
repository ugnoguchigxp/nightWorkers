import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { client } from "./api";
import { apiPath } from "./api-base";

interface User {
	id: string;
	email: string;
}

interface AuthContextType {
	user: User | null;
	isLoading: boolean;
	apiAuthRequired: boolean;
	login: (user: User) => void;
	logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [apiAuthRequired, setApiAuthRequired] = useState(false);

	useEffect(() => {
		const initAuth = async () => {
			try {
				const methodsRes = await fetch(apiPath("/api/auth/methods"), {
					credentials: "include",
				});
				if (methodsRes.ok) {
					const methods = (await methodsRes.json()) as {
						apiAuthRequired?: boolean;
					};
					const required = Boolean(methods.apiAuthRequired);
					setApiAuthRequired(required);
					if (!required) {
						setUser(null);
						setIsLoading(false);
						return;
					}
				}

				const res = await client.auth.me.$get({});
				if (res.ok) {
					const data = (await res.json()) as { userId: string; email: string };
					setUser({ id: data.userId, email: data.email });
				} else {
					setUser(null);
				}
			} catch {
				setUser(null);
			}
			setIsLoading(false);
		};

		initAuth();
	}, []);

	const login = (user: User) => {
		setUser(user);
	};

	const logout = async () => {
		try {
			await client.auth.logout.$post({});
		} catch {
			// ignore network error on logout
		}
		setUser(null);
	};

	return (
		<AuthContext.Provider
			value={{ user, isLoading, apiAuthRequired, login, logout }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
