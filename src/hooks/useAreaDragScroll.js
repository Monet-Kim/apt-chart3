// src/hooks/useAreaDragScroll.js
import { useRef } from 'react';

export function useAreaDragScroll() {
  const scrollRef = useRef(null);
  const dragRef = useRef({ down: false, startX: 0, startLeft: 0 });

  const onMouseDown = (e) => {
    const el = scrollRef.current;
    if (!el) return;
    dragRef.current = { down: true, startX: e.pageX, startLeft: el.scrollLeft };
  };

  const onMouseMove = (e) => {
    const el = scrollRef.current;
    if (!el || !dragRef.current.down) return;
    el.scrollLeft = dragRef.current.startLeft - (e.pageX - dragRef.current.startX);
  };

  const onMouseUp = () => { dragRef.current.down = false; };

  return { scrollRef, dragRef, onMouseDown, onMouseMove, onMouseUp };
}
