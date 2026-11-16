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
      const next = nav && a ? { top: a.offsetTop, height: a.offsetHeight } : null;
      setBox((b) => (b?.top === next?.top && b?.height === next?.height ? b : next));
    };
    measure();
    first.current = false;
    // Fonti zikimaliza kupakia, urefu wa viungo unaweza kubadilika
    document.fonts?.ready.then(measure).catch(() => undefined);
    window.addEventListener('resize', measure);
    // Menyu ikibadilika (mf. kipengele kinafichwa/kuongezwa) kiashiria kifuate kipengele kilichochaguliwa
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null;
    if (mo && navRef.current) mo.observe(navRef.current, { childList: true, subtree: true });
    return () => { window.removeEventListener('resize', measure); mo?.disconnect(); };
  }, [loc.pathname, navRef]);
  return box;
}

export function NavIndicator({ box }: { box: { top: number; height: number } | null }) {
  if (!box) return null;
  return <span className="nav-indicator" aria-hidden="true" style={{ transform: `translateY(${box.top}px)`, height: box.height }} />;
}
