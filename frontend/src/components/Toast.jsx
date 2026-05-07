import React from 'react';

export default function Toast({ toast }) {
  return (
    <div className={`toast ${toast.message ? 'show' : ''} ${toast.type === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  );
}
