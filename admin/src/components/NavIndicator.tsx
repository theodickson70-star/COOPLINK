// Kiashiria cha dhahabu kinachoteleza kwenda kwenye kiungo kilicho wazi (animation ya sidebar)
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

export function useNavIndicator(navRef: RefObject<HTMLElement | null>) {
  const loc = useLocation();
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const measure = () => {
      const nav = navRef.current;
      const a = nav?.querySelector<HTMLElement>('a.active');
      setBox(nav && a ? { top: a.offsetTop, height: a.offsetHeight } : null);
    };
    measure();
    first.current = false;
    // Fonti zikimaliza kupakia, urefu wa viungo unaweza kubadilika
    document.fonts?.ready.then(measure).catch(() => undefined);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [loc.pathname, navRef]);
  return box;
}

export function NavIndicator({ box }: { box: { top: number; height: number } | null }) {
  if (!box) return null;
  return <span className="nav-indicator" aria-hidden="true" style={{ transform: `translateY(${box.top}px)`, height: box.height }} />;
}
