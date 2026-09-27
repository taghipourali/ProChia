import { Link } from 'react-router';
import { Empty } from '@prochia/ui';

export function NotFoundPage() {
  return (
    <Empty icon="search" title="این صفحه پیدا نشد">
      <Link to="/" className="pc-btn pc-btn--s" style={{ marginTop: 8 }}>
        رفتن به منو
      </Link>
    </Empty>
  );
}
