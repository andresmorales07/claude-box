import { create } from "zustand";

interface AuthState {
  token: string;
  authenticated: boolean;
  setToken: (token: string) => void;
  login: () => void;
  logout: () => void;
}

const storedToken = localStorage.getItem("api_token") ?? "";

export const useAuthStore = create<AuthState>((set) => ({
  token: storedToken,
  authenticated: storedToken.length > 0,
  setToken: (token) => set({ token }),
  login: () => {
    const token = useAuthStore.getState().token;
    localStorage.setItem("api_token", token);
    set({ authenticated: true });
  },
  logout: () => {
    localStorage.removeItem("api_token");
    set({ token: "", authenticated: false });
  },
}));
