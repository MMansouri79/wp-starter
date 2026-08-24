<?php
$root = dirname( __DIR__ );
$targets = array(
    $root . '/wordpress/exporter',
    $root . '/wordpress/bootstrap',
);

$failed = false;

foreach ( $targets as $target ) {
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator( $target, FilesystemIterator::SKIP_DOTS )
    );

    foreach ( $iterator as $file ) {
        if ( 'php' !== strtolower( $file->getExtension() ) ) {
            continue;
        }

        $path = $file->getPathname();
        $cmd  = escapeshellarg( PHP_BINARY ) . ' -l ' . escapeshellarg( $path );
        passthru( $cmd, $code );

        if ( 0 !== $code ) {
            $failed = true;
        }
    }
}

exit( $failed ? 1 : 0 );
