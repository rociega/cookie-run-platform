import { motion, useScroll, useSpring } from "framer-motion";

export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  return (
    <motion.div
      className="scroll-progress fixed top-0 left-0 right-0 h-[3px] z-[60]"
      style={{ scaleX }}
      data-testid="scroll-progress"
    />
  );
}
