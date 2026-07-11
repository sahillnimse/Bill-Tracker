import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../api/client";

const AuthContext = createContext(null);


export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(() => {
        setLoading(true);
        return api
            .getMe()
            .then((data) => setUser(data))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const enrollStart = useCallback((email) => api.enrollStart(email), []);
    const enrollConfirm = useCallback((email, code) => api.enrollConfirm(email, code).then(refresh), [refresh]);
    const login = useCallback((email, code) => api.login(email, code).then(refresh), [refresh]);

    const logout = useCallback(() => {
        api.logout().finally(() => {
            setUser(null);
            window.location.href = "/";
        });
    }, []);

    return (
        <AuthContext.Provider value={{ user, loading, isAuthenticated: !!user, login, enrollStart, enrollConfirm, logout, refresh }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}