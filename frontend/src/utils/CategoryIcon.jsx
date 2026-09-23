import { getCategoryIcon } from './categoryIcons';

export function CategoryIcon({ category, className }) {
  const Icon = getCategoryIcon(category);
  // eslint-disable-next-line react-hooks/static-components
  return <Icon className={className} />;
}
