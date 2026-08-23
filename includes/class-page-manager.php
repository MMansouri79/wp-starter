<?php
namespace MMS\SiteStarter;

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

final class Page_Manager {
    /**
     * Create missing profile pages and configure front/posts pages.
     *
     * @param array $profile Profile configuration.
     * @return array[]
     */
    public function apply( array $profile ) {
        $results = array();
        $ids     = array();

        foreach ( $profile['pages'] as $page ) {
            $existing = get_page_by_path( $page['slug'], OBJECT, 'page' );

            if ( $existing ) {
                $ids[ $page['slug'] ] = (int) $existing->ID;
                $results[] = $this->result( 'success', 'Pages', $page['title'] . ' already exists.' );
                continue;
            }

            $post_id = wp_insert_post(
                array(
                    'post_title'  => $page['title'],
                    'post_name'   => $page['slug'],
                    'post_type'   => 'page',
                    'post_status' => 'publish',
                    'post_content'=> '',
                ),
                true
            );

            if ( is_wp_error( $post_id ) ) {
                $results[] = $this->result( 'error', 'Pages', $post_id->get_error_message() );
                continue;
            }

            $ids[ $page['slug'] ] = (int) $post_id;
            $results[] = $this->result( 'success', 'Pages', $page['title'] . ' created.' );
        }

        $front_slug = isset( $profile['front_page_slug'] ) ? $profile['front_page_slug'] : '';
        $posts_slug = isset( $profile['posts_page_slug'] ) ? $profile['posts_page_slug'] : '';

        if ( $front_slug && isset( $ids[ $front_slug ] ) ) {
            update_option( 'show_on_front', 'page' );
            update_option( 'page_on_front', $ids[ $front_slug ] );
            $results[] = $this->result( 'success', 'Pages', 'Static front page configured.' );
        }

        if ( $posts_slug && isset( $ids[ $posts_slug ] ) ) {
            update_option( 'page_for_posts', $ids[ $posts_slug ] );
            $results[] = $this->result( 'success', 'Pages', 'Posts page configured.' );
        }

        return $results;
    }

    /** @return array */
    private function result( $status, $label, $message ) {
        return array(
            'status'  => $status,
            'label'   => $label,
            'message' => $message,
        );
    }
}
