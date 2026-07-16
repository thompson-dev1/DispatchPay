import PageShell from '../components/ui/page-shell';

function LoginPage() {
  return (
    <PageShell title="Rider Login">
      <p>
        Rider OTP login screen scaffolded. Next step: wire <code>/api/v1/auth/rider/login-otp</code>
        and <code>/api/v1/auth/rider/verify-otp</code> with React Hook Form.
      </p>
    </PageShell>
  );
}

export default LoginPage;
