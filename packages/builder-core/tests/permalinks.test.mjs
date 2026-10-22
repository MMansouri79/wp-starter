import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('bootstrap refreshes the rewrite object before flushing default and snapshot permalinks', () => {
  const bootstrap = fileURLToPath(new URL('../../../wordpress/bootstrap/site-starter-bootstrap.php', import.meta.url));
  const code = `
    define('ABSPATH', __DIR__);
    function add_action() {}
    $flushed = array();
    class TestRewrite {
      public $permalink_structure = '/%year%/%monthnum%/%day%/%postname%/';
      function set_permalink_structure($value) { $this->permalink_structure = $value; }
    }
    $wp_rewrite = new TestRewrite();
    function flush_rewrite_rules($hard) {
      global $wp_rewrite, $flushed;
      if ($hard) { throw new Exception('Unexpected server configuration write'); }
      $flushed[] = $wp_rewrite->permalink_structure;
    }
    require ${JSON.stringify(bootstrap.replaceAll('\\', '/'))};
    $method = new ReflectionMethod('MMS_WP_Starter_Bootstrap', 'finalize_permalinks');
    $method->setAccessible(true);
    $method->invoke(null, array());
    $method->invoke(null, array('wordpress'=>array('permalink_structure'=>'')));
    $method->invoke(null, array('wordpress'=>array('permalink_structure'=>'/%year%/%postname%/')));
    echo json_encode($flushed);
  `;
  const result = spawnSync('php', ['-r', code], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), ['/%postname%/', '/%postname%/', '/%year%/%postname%/']);
});
