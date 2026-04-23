import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor } from "lucide-react";

type Theme = 'light' | 'dark' | 'system';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as Theme || 'system';
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    
    if (newTheme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.toggle('dark', systemTheme === 'dark');
    } else {
      root.classList.toggle('dark', newTheme === 'dark');
    }
  };

  const handleThemeChange = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextTheme = themes[(currentIndex + 1) % themes.length];
    
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    applyTheme(nextTheme);
  };

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun className="w-4 h-4" />;
      case 'dark':
        return <Moon className="w-4 h-4" />;
      case 'system':
        return <Monitor className="w-4 h-4" />;
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleThemeChange}
      className="w-9 h-9 p-0 hover:bg-gray-100 dark:hover:bg-gray-800 transition-all duration-200"
      title={`Current: ${theme} theme`}
    >
      {getIcon()}
    </Button>
  );
}