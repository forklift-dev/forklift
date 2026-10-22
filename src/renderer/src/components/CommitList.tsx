import type { Commit } from '../../../shared/state';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function CommitList({ commits }: { commits: Commit[] }) {
  if (commits.length === 0) {
    return <section className="commits empty-note">No commits yet</section>;
  }
  return (
    <section className="commits">
      <table>
        <thead>
          <tr>
            <th>Message</th>
            <th>Author</th>
            <th>Date</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((commit) => (
            <tr key={commit.hash}>
              <td className="subject">
                {commit.refs.map((ref) => (
                  <span key={ref} className={ref.startsWith('tag: ') ? 'ref tag' : 'ref'}>
                    {ref}
                  </span>
                ))}
                {commit.subject}
              </td>
              <td title={commit.authorEmail}>{commit.authorName}</td>
              <td>{dateFormat.format(commit.authorTime * 1000)}</td>
              <td className="hash">{commit.hash.slice(0, 7)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
