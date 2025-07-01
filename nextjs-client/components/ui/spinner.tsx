'use client';

import { motion } from 'framer-motion';

const Spinner = () => (
  <motion.div
    className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full"
    animate={{ rotate: 360 }}
    transition={{
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    }}
  />
);

export default Spinner;
