import { useCallback, useState } from 'react';
import { useAppContext } from '../store/AppContext.jsx';

export function useAsync() {
  const [loading, setLoading] = useState(false);
  const { showNotification, startGlobalLoading, stopGlobalLoading } = useAppContext();

  const run = useCallback(
    async (task, successMessage, loadingMessage) => {
      setLoading(true);
      startGlobalLoading(loadingMessage);
      try {
        const result = await task();
        if (successMessage) showNotification(successMessage);
        return result;
      } catch (error) {
        showNotification(error.message, 'error');
        throw error;
      } finally {
        setLoading(false);
        stopGlobalLoading();
      }
    },
    [showNotification, startGlobalLoading, stopGlobalLoading],
  );

  return { loading, run };
}
