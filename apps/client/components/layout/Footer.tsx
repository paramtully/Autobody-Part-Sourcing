import Container from './Container';

export default function Footer() {
  return (
    <footer className="mt-auto border-t bg-[#111827] text-gray-400 text-[12px]">
      <Container className="py-4 flex items-center justify-between gap-4 flex-wrap">
        <span>© {new Date().getFullYear()} Boneyard. All rights reserved.</span>
        <div className="flex items-center gap-4">
          <span className="text-gray-500">For collision repair professionals</span>
        </div>
      </Container>
    </footer>
  );
}
