'use client';

import { ToastContainer } from 'react-toastify';

export const ToastProvider: React.FC = () => {
  return <ToastContainer theme="dark" position="bottom-right" autoClose={4000} newestOnTop />;
};

export default ToastProvider;
