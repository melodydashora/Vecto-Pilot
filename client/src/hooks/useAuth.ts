import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";

interface User {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  profileImageUrl?: string;
}

export function useAuth() {
  const [skipAuth, setSkipAuth] = useState(false);
  
  // Check if user has chosen to skip auth
  useEffect(() => {
    const skip = localStorage.getItem("skipAuth");
    if (skip === "true") {
      setSkipAuth(true);
    }
  }, []);

  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["/api/auth/user"],
    retry: false,
    enabled: !skipAuth, // Don't fetch if auth is skipped
  });

  const enableSkipAuth = () => {
    localStorage.setItem("skipAuth", "true");
    setSkipAuth(true);
    window.location.reload();
  };

  const disableSkipAuth = () => {
    localStorage.removeItem("skipAuth");
    setSkipAuth(false);
    window.location.href = "/api/login";
  };

  return {
    user,
    isLoading: !skipAuth && isLoading,
    isAuthenticated: skipAuth || !!user,
    skipAuth,
    enableSkipAuth,
    disableSkipAuth,
  };
}