import { useEffect, useState } from 'react';

const read = () => ({ width: window.innerWidth, height: window.innerHeight });

/** The window size, and whether it is portrait; re-renders on resize. */
export function useScreen() {
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { ...size, isPortrait: size.height > size.width };
}
