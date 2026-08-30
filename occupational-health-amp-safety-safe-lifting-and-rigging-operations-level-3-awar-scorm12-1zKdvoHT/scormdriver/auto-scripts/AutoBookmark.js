// version: 7.12.0.a.1.6.6
// sha: f7191d4eb4009ad223fba1d22c9e1e03037e393f
function SetBookmark(){var o=window.parent,t=window.location.href;o.SetBookmark(t.substring(t.toLowerCase().lastIndexOf("/scormcontent/")+14,t.length),document.title),o.CommitData()}SetBookmark();