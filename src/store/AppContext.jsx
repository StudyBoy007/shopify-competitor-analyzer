import { createContext, useCallback, useContext, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [notification, setNotification] = useState(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalLoadingMessage, setGlobalLoadingMessage] = useState('');
  const [currentUser, setCurrentUser] = useState(null);

  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type, id: Date.now() });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const startGlobalLoading = useCallback((message) => {
    setGlobalLoadingMessage(message || '正在处理请求');
    setGlobalLoading(true);
  }, []);

  const stopGlobalLoading = useCallback(() => {
    setGlobalLoading(false);
    setGlobalLoadingMessage('');
  }, []);

  return (
    <AppContext.Provider value={{
      notification,
      showNotification,
      globalLoading,
      globalLoadingMessage,
      currentUser,
      setCurrentUser,
      startGlobalLoading,
      stopGlobalLoading,
    }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext 必须在 AppProvider 内使用');
  }
  return context;
}
