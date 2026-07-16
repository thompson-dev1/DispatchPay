import { Link } from 'react-router-dom';

function RegisterPage() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px' }}>
      <section style={{ maxWidth: '560px', width: '100%' }}>
        <h1>Business Registration</h1>
        <p>
          Registration UI is scaffolded and ready. Next step is wiring the shared Zod schema
          and React Hook Form flow for <code>/api/v1/auth/business/register</code>.
        </p>
        <p>
          <Link to="/login">Back to login</Link>
        </p>
      </section>
    </main>
  );
}

export default RegisterPage;
