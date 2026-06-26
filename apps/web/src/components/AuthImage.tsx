import { useEffect, useState } from 'react';

interface AuthImageProps {
  src: string;
  alt?: string;
  className?: string;
}

export function AuthImage({ src, alt = '', className }: AuthImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    setError(false);
    setObjectUrl(null);

    const token = localStorage.getItem('wh_token');
    fetch(src, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (!revoked) setObjectUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!revoked) setError(true);
      });

    return () => {
      revoked = true;
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [src]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-400 text-xs ${className ?? ''}`}>
        Failed
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className={`animate-pulse bg-gray-200 ${className ?? ''}`} />
    );
  }

  return <img src={objectUrl} alt={alt} className={className} />;
}
